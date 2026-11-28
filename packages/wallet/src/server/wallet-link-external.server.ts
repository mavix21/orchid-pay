import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  type Approval,
  type UnclaimedFundsGone,
  type UnclaimedFundsId,
  ExternalLinkDraft,
  type ExternalLinkFailed,
  type ExternalLinkOrder,
  type ExternalLinkPending,
  type ExternalLinkSettled,
  type ExternalLinkStep,
  InvalidAddress,
  LinkUnclaimable,
  NotClaimable,
  PaymentLinkChecking,
  type PayoutTerms,
  RecipientCannotReceive,
  type SigningRequest,
} from "../contract";
import {
  type AssetAuthorized,
  AssetOrders,
  type ConcludedReceipt,
  type StoredAssetOrder,
  StoredOrderJson,
  toStoredExternalOrder,
} from "./AssetOrders.server";
import {
  Chain,
  type ChainUnreachable,
  DraftPurpose,
  type LinkReceive,
} from "./Chain.server";
import { StoreFailure } from "./Directory.server";
import { type FundedLink, Transfers } from "./Transfers.server";
import { live } from "./wallet-reads.server";

export type OrderReceipt =
  | ExternalLinkPending
  | ExternalLinkSettled
  | ExternalLinkFailed;

export interface LinkReceiveShared {
  readonly liveLink: (
    link: AccountAddress,
    funded: FundedLink,
  ) => Effect.Effect<
    { readonly matched: boolean; readonly present: boolean },
    ChainUnreachable
  >;
  readonly settleOnUnclaimedFunds: (
    unclaimedFunds: UnclaimedFundsId,
  ) => Effect.Effect<
    {
      readonly checking: boolean;
      readonly current: ReadonlyArray<StoredAssetOrder>;
    },
    StoreFailure | ChainUnreachable
  >;
  readonly unclaimedFundsGone: (
    unclaimedFunds: UnclaimedFundsId,
  ) => Effect.Effect<UnclaimedFundsGone, StoreFailure | ChainUnreachable>;
  readonly settled: (
    stored: AssetAuthorized,
  ) => Effect.Effect<
    | OrderReceipt
    | import("../contract").AssetPending
    | import("../contract").AssetSettled
    | import("../contract").AssetFailed,
    StoreFailure | ChainUnreachable
  >;
}

const externalReceipt = (
  receipt: ConcludedReceipt,
): Effect.Effect<ExternalLinkSettled | ExternalLinkFailed, StoreFailure> =>
  Predicate.isTagged(receipt, "ExternalLinkSettled") ||
  Predicate.isTagged(receipt, "ExternalLinkFailed")
    ? Effect.succeed(receipt)
    : Effect.fail(
        new StoreFailure({
          cause: new Error("External link order produced a wallet receipt"),
        }),
      );

const externalStep = (
  receipt:
    | OrderReceipt
    | import("../contract").AssetPending
    | import("../contract").AssetSettled
    | import("../contract").AssetFailed,
): Effect.Effect<OrderReceipt, StoreFailure> =>
  Predicate.isTagged(receipt, "ExternalLinkPending") ||
  Predicate.isTagged(receipt, "ExternalLinkSettled") ||
  Predicate.isTagged(receipt, "ExternalLinkFailed")
    ? Effect.succeed(receipt)
    : Effect.fail(
        new StoreFailure({
          cause: new Error("External link order produced a wallet step"),
        }),
      );

export const externalLinkClaimFlow = (shared: LinkReceiveShared) =>
  Effect.gen(function* () {
    const chain = yield* Chain;
    const orders = yield* AssetOrders;
    const transfers = yield* Transfers;

    const reconcileExternal = (stored: AssetAuthorized) =>
      shared.settled(stored).pipe(Effect.flatMap(externalStep));

    return Effect.fn("Wallet.claimPaymentLink")(function* (
      order: ExternalLinkOrder,
      approval: Option.Option<Approval>,
      payout: Option.Option<PayoutTerms> = Option.none(),
    ): Effect.fn.Return<ExternalLinkStep, StoreFailure | ChainUnreachable> {
      if (!chain.validAddress(order.link))
        return new InvalidAddress({ address: order.link });

      if (!chain.validAddress(order.destination))
        return new InvalidAddress({ address: order.destination });

      const storedOrder = toStoredExternalOrder(order, payout);
      const existing = yield* orders.find(order.id);

      if (Option.isSome(existing)) {
        if (
          Schema.encodeSync(StoredOrderJson)(existing.value.order) !==
          Schema.encodeSync(StoredOrderJson)(storedOrder)
        )
          return yield* new StoreFailure({
            cause: new Error(
              "Asset order id cannot identify a different order",
            ),
          });

        if (Predicate.isTagged(existing.value, "AssetConcluded"))
          return yield* externalReceipt(existing.value.receipt);

        if (Predicate.isTagged(existing.value, "AssetAuthorized"))
          return yield* reconcileExternal(existing.value);
      }

      const funded = yield* transfers.fundedLink(order.link);

      if (
        Option.isNone(funded) ||
        funded.value.unclaimedFunds !== order.unclaimedFunds
      )
        return new NotClaimable({ claimableAt: Option.none() });

      const { checking } = yield* shared.settleOnUnclaimedFunds(
        order.unclaimedFunds,
      );

      if (checking) return new PaymentLinkChecking();

      const { matched, present } = yield* shared.liveLink(
        order.link,
        funded.value,
      );

      if (!matched)
        return present
          ? new NotClaimable({ claimableAt: Option.none() })
          : yield* shared.unclaimedFundsGone(order.unclaimedFunds);

      const { asset, amount } = funded.value;

      const receivingAccount = Schema.decodeSync(AccountAddress)(
        order.destination,
      );

      if (receivingAccount === order.link)
        return new LinkUnclaimable({ reason: "destination_is_link" });

      const blocker = yield* chain.receiveBlocker(
        receivingAccount,
        asset,
        amount,
      );

      if (Option.isSome(blocker))
        return new RecipientCannotReceive({
          address: receivingAccount,
          reason: blocker.value,
        });

      const terms: LinkReceive = {
        link: order.link,
        destination: order.destination,
        unclaimedFunds: order.unclaimedFunds,
        asset,
        amount,
        memo: order.memo,
      };

      const prepared = yield* chain.prepareLinkReceive(terms);

      if (prepared instanceof LinkUnclaimable) return prepared;

      const current = (request: SigningRequest) =>
        chain.draftCurrent(
          request,
          DraftPurpose.LinkReceive({ receive: prepared }),
        );

      const proposed = Option.filter(existing, (stored) =>
        Predicate.isTagged(stored, "AssetProposed"),
      );

      if (
        Option.isSome(proposed) &&
        Predicate.isTagged(proposed.value, "AssetProposed") &&
        (yield* live(proposed.value.request)) &&
        (yield* current(proposed.value.request))
      ) {
        const stored = proposed.value;

        if (Option.isNone(approval))
          return new ExternalLinkDraft({ request: stored.request });

        const sealed = yield* chain
          .seal(stored.request, approval.value, order.link)
          .pipe(Effect.option);

        if (Option.isNone(sealed) || !(yield* current(stored.request)))
          return new ExternalLinkDraft({ request: stored.request });

        const authorized = yield* orders.authorizeExternal(
          stored,
          sealed.value,
        );

        return yield* Match.valueTags(authorized, {
          SlotOccupied: () => Effect.succeed(new PaymentLinkChecking()),
          AssetAuthorized: reconcileExternal,
          AssetConcluded: (concluded) => externalReceipt(concluded.receipt),
          AssetProposed: (next) =>
            Effect.succeed(new ExternalLinkDraft({ request: next.request })),
        });
      }

      const request = yield* chain.draftLinkReceive(prepared);

      const stored =
        Option.isSome(proposed) &&
        Predicate.isTagged(proposed.value, "AssetProposed")
          ? yield* orders.redraft(proposed.value, request)
          : yield* orders.propose(storedOrder, request);

      return yield* Match.valueTags(stored, {
        AssetAuthorized: reconcileExternal,
        AssetConcluded: (concluded) => externalReceipt(concluded.receipt),
        AssetProposed: (next) =>
          Effect.succeed(new ExternalLinkDraft({ request: next.request })),
      });
    });
  });
