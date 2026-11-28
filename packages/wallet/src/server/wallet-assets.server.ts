import { Transfers } from "./Transfers.server";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type Approval,
  AssetOrder,
  AssetStep,
  AssetDraft,
  AssetBusy,
  InvalidAddress,
  NotClaimable,
  NotOpened,
  RecipientCannotReceive,
  SenderBusy,
} from "../contract";
import { type AssetPlan, ClaimPlan } from "./asset-plan.server";
import {
  AssetOrders,
  AssetAuthorized,
  type ConcludedReceipt,
  StoredOrderJson,
  assetPending,
  orderPending,
} from "./AssetOrders.server";
import {
  type Applied,
  Chain,
  type ChainUnreachable,
  DraftPurpose,
  type Expired,
  type Rejected,
} from "./Chain.server";
import { Directory, StoreFailure } from "./Directory.server";
import { linkReceiveFlow } from "./wallet-link-receive.server";
import { transferReconcileFlow } from "./wallet-reconcile.server";
import { live } from "./wallet-reads.server";

export const assetFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const orders = yield* AssetOrders;
  const directory = yield* Directory;
  const transfers = yield* Transfers;
  const reconcileTransfer = yield* transferReconcileFlow;

  const reconcileOrder = Effect.fn("Wallet.reconcileAsset")(function* (
    stored: AssetAuthorized,
  ) {
    const evidence = yield* chain.settlement(stored.sealed);

    const concluded = (decided: Applied | Rejected | Expired) =>
      orders
        .conclude(stored.order.id, decided)
        .pipe(Effect.map((done) => done.receipt));

    return yield* Match.valueTags(evidence, {
      Applied: concluded,
      Rejected: concluded,
      Expired: concluded,
      Undecided: () =>
        chain.submit(stored.sealed).pipe(
          Effect.catch((failure) =>
            Effect.logWarning("Asset order resubmission failed", failure),
          ),
          Effect.as(orderPending(stored)),
        ),
    });
  });

  const links = yield* linkReceiveFlow(reconcileOrder);

  const reconcile = reconcileOrder;

  const stillPending = (step: Effect.Success<ReturnType<typeof reconcile>>) =>
    Predicate.isTagged(step, "AssetPending") ||
    Predicate.isTagged(step, "ExternalLinkPending");

  const walletReceipt = (receipt: ConcludedReceipt) =>
    Predicate.isTagged(receipt, "AssetSettled") ||
    Predicate.isTagged(receipt, "AssetFailed")
      ? Effect.succeed(receipt)
      : Effect.fail(
          new StoreFailure({
            cause: new Error("Wallet asset order produced an external receipt"),
          }),
        );

  const reconcileWallet = (stored: AssetAuthorized) =>
    reconcile(stored).pipe(
      Effect.flatMap((step) =>
        Predicate.isTagged(step, "AssetPending") ||
        Predicate.isTagged(step, "AssetSettled") ||
        Predicate.isTagged(step, "AssetFailed")
          ? Effect.succeed(step)
          : Effect.fail(
              new StoreFailure({
                cause: new Error(
                  "Wallet asset order produced an external step",
                ),
              }),
            ),
      ),
    );

  const manage = Effect.fn("Wallet.manage")(function* (
    order: AssetOrder,
    approval: Option.Option<Approval>,
  ): Effect.fn.Return<AssetStep, StoreFailure | ChainUnreachable> {
    if (!chain.validAddress(order.wallet))
      return new InvalidAddress({ address: order.wallet });

    const row = yield* directory.byAddress(order.wallet);

    const opening =
      Option.isSome(row) &&
      row.value.status === "opening" &&
      Predicate.isTagged(order.action, "ReceiveLink");

    if (Option.isNone(row) || (row.value.status !== "active" && !opening))
      return new NotOpened();
    const existing = yield* orders.find(order.id);

    if (Option.isSome(existing)) {
      if (
        !(existing.value.order instanceof AssetOrder) ||
        Schema.encodeSync(StoredOrderJson)(existing.value.order) !==
          Schema.encodeSync(StoredOrderJson)(order)
      )
        return yield* new StoreFailure({
          cause: new Error("Asset order id cannot identify a different order"),
        });

      if (Predicate.isTagged(existing.value, "AssetConcluded"))
        return yield* walletReceipt(existing.value.receipt);

      if (Predicate.isTagged(existing.value, "AssetAuthorized"))
        return yield* reconcileWallet(existing.value);
    }

    const paying = yield* transfers.latestFrom(order.wallet);

    if (
      Option.isSome(paying) &&
      Predicate.isTagged(paying.value, "Authorized")
    ) {
      const receipt = yield* reconcileTransfer(paying.value);

      if (Predicate.isTagged(receipt, "Pending"))
        return new SenderBusy({ inFlight: receipt });
    }

    const held = yield* orders.inFlightFor(order.wallet);

    if (Option.isSome(held) && stillPending(yield* reconcile(held.value)))
      return new AssetBusy({ inFlight: assetPending(held.value) });

    const action = order.action;

    if (Predicate.isTagged(action, "ReceiveLink"))
      return yield* links.receive(order, action, approval, existing, opening);

    const entries = yield* chain.unclaimedFunds([action.unclaimedFunds]);
    const entry = entries[0];

    if (!entry)
      return yield* links.unclaimedFundsGone(
        action.unclaimedFunds,
        Option.some(order.wallet),
      );

    const claim = entry.claimOf(order.wallet);
    const now = yield* DateTime.now;

    if (!Option.exists(claim, (item) => item.claimableAt(now)))
      return new NotClaimable({ claimableAt: Option.none() });

    const plan: AssetPlan = ClaimPlan.make({
      unclaimedFunds: action.unclaimedFunds,
    });

    const blocker = yield* chain.receiveBlocker(
      order.wallet,
      entry.asset,
      entry.amount,
    );

    if (Option.isSome(blocker))
      return blocker.value === "no_account"
        ? new NotOpened()
        : new RecipientCannotReceive({
            address: order.wallet,
            reason: blocker.value,
          });

    if (
      Option.isSome(existing) &&
      Predicate.isTagged(existing.value, "AssetProposed") &&
      (yield* live(existing.value.request))
    ) {
      const stored = existing.value;

      const current = yield* chain.draftCurrent(
        stored.request,
        DraftPurpose.AssetChange({ address: order.wallet, plan }),
      );

      if (current) {
        if (Option.isNone(approval))
          return new AssetDraft({ request: stored.request });

        const sealed = yield* chain
          .seal(stored.request, approval.value, order.wallet)
          .pipe(Effect.option);

        if (Option.isNone(sealed))
          return new AssetDraft({ request: stored.request });
        const authorized = yield* orders.authorize(stored, sealed.value);

        return yield* Match.valueTags(authorized, {
          SlotOccupied: () =>
            Effect.succeed(new AssetDraft({ request: stored.request })),
          WalletInactive: () => Effect.succeed(new NotOpened()),
          AssetAuthorized: reconcileWallet,
          AssetConcluded: (concluded) => walletReceipt(concluded.receipt),
          AssetProposed: (proposed) =>
            Effect.succeed(new AssetDraft({ request: proposed.request })),
        });
      }
    }

    const request = yield* chain.draftAsset(order.wallet, plan);

    const stored =
      Option.isSome(existing) &&
      Predicate.isTagged(existing.value, "AssetProposed")
        ? yield* orders.redraft(existing.value, request)
        : yield* orders.propose(order, request);

    return yield* Match.valueTags(stored, {
      AssetAuthorized: reconcileWallet,
      AssetConcluded: (concluded) => walletReceipt(concluded.receipt),
      AssetProposed: (proposed) =>
        Effect.succeed(new AssetDraft({ request: proposed.request })),
    });
  });

  return {
    manage,
    claimPaymentLink: links.claimExternal,
    reconcile,
    reconcilePending: (stored: AssetAuthorized) =>
      reconcile(stored).pipe(Effect.map(stillPending)),
    paymentLink: links.paymentLink,
  };
});
