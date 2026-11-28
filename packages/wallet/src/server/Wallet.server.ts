import { portfolioFlow } from "./wallet-portfolio.server";
import { deliveryFlow } from "./wallet-delivery.server";
import {
  Examined,
  type TransferEffects,
  transferCheckFlow,
} from "./wallet-transfer-check.server";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  SigningRequest,
  AssessmentStep,
  CheckedRecipient,
  RecipientStep,
  AssetBusy,
  UnclaimedFundsLimitReached,
  Approval,
  Holding,
  InvalidAddress,
  MemoNotAllowed,
  NeedsReopening,
  NotOpened,
  Overview,
  Receipt,
  SenderBusy,
  TransferDraft,
  TransferIntent,
  TransferOrder,
  TransferStep,
  type WalletPort,
  type ServerFailure,
} from "../contract";
import {
  Chain,
  ChainUnreachable,
  DraftPurpose,
  type Sealed,
} from "./Chain.server";
import { chainLayer } from "../binding/chain.server";
import { memoRefusal } from "./memo-refusal.server";
import { Directory, StoreFailure, type WalletRow } from "./Directory.server";
import { sealedOpening } from "./opening-attempt.server";
import {
  Authorized,
  type Concluded,
  OrderJson,
  Proposed,
  type Transfer,
  Transfers,
} from "./Transfers.server";
import { AssetOrders, assetPending } from "./AssetOrders.server";
import { assetFlow } from "./wallet-assets.server";
import { openingFlow } from "./wallet-opening.server";
import { Backups } from "./Backups.server";
import { Principal } from "./Principal.server";
import { Deposits } from "./Deposits.server";
import { HumanCheck } from "./HumanCheck.server";
import { concealFailure } from "./failures.server";
import { backupFlow } from "./wallet-backup.server";
import { activityFlow } from "./wallet-activity.server";
import { paymentLinksFlow } from "./wallet-payment-links.server";
import { payoutFlow } from "./wallet-payouts.server";
import { confirmedReads, live } from "./wallet-reads.server";
import { claimableQuotaFlow } from "./claimable-quota.server";
import { transferReconcileFlow } from "./wallet-reconcile.server";
import type { PendingWork, WorkAttended } from "./work-queue.server";
import { sweepFlow } from "./wallet-sweep.server";
import { depositFlow } from "./wallet-deposits.server";
import { workFlow } from "./wallet-work.server";

export class Wallet extends Context.Service<
  Wallet,
  WalletPort<ServerFailure> & {
    assess(
      address: AccountAddress,
      intent: TransferIntent,
    ): Effect.Effect<AssessmentStep, ServerFailure>;
    checkRecipient(
      to: CheckedRecipient,
    ): Effect.Effect<RecipientStep, ServerFailure>;
    readonly sweep: Effect.Effect<void, ServerFailure>;
    readonly ingestDeposits: Effect.Effect<void, ServerFailure>;
    readonly scheduled: Effect.Effect<void, ServerFailure>;
    attend(
      work: PendingWork,
      attempt: number,
    ): Effect.Effect<WorkAttended, ServerFailure>;
  }
>()("@workspace/wallet/server/Wallet") {
  static readonly serviceLayer = Layer.effect(
    Wallet,
    Effect.gen(function* () {
      const chain = yield* Chain;
      const directory = yield* Directory;
      const transfers = yield* Transfers;
      const assets = yield* AssetOrders;
      const reconcile = yield* transferReconcileFlow;
      const assetActions = yield* assetFlow;
      const { delivery, draft } = yield* deliveryFlow;
      const check = yield* transferCheckFlow;
      const { quotaFull } = yield* claimableQuotaFlow;
      const links = yield* paymentLinksFlow;

      const payouts = yield* payoutFlow({
        claimExternal: assetActions.claimPaymentLink,
        reconcile: assetActions.reconcile,
      });

      const history = yield* activityFlow;
      const { portfolio } = yield* portfolioFlow;

      const wrap = <A, E>(program: Effect.Effect<A, E>) =>
        program.pipe(Effect.catchCause(concealFailure));

      const { readBalance } = yield* confirmedReads;
      const { open, resume, reconcileOpening } = yield* openingFlow;
      const backup = yield* backupFlow;

      const proposedStep = (
        proposed: Proposed,
      ): TransferDraft | MemoNotAllowed => {
        const refusal = memoRefusal(proposed.order, proposed.recipient);

        if (Option.isSome(refusal)) return refusal.value;

        return new TransferDraft({
          request: proposed.request,
          recipient: proposed.recipient,
          unclaimedFunds: proposed.unclaimedFunds,
        });
      };

      const signedStep = (signed: Authorized | Concluded) =>
        Match.valueTags(signed, {
          Concluded: (concluded) => Effect.succeed(concluded.receipt),
          Authorized: reconcile,
        });

      const resumed = Effect.fn("Wallet.resumed")(function* (
        transfer: Transfer,
      ): Effect.fn.Return<TransferStep, StoreFailure | ChainUnreachable> {
        return Predicate.isTagged(transfer, "Proposed")
          ? proposedStep(transfer)
          : yield* signedStep(transfer);
      });

      const redrafted = Effect.fn("Wallet.redrafted")(function* (
        stored: Proposed,
      ) {
        const request = yield* delivery(stored.order, stored.recipient);

        return request instanceof SigningRequest
          ? yield* resumed(
              yield* transfers.redraft(
                stored,
                request,
                chain.unclaimedFundsCreatedBy(request),
              ),
            )
          : request;
      });

      const currentDraft = Effect.fn("Wallet.currentDraft")(function* (
        stored: Proposed,
      ) {
        return yield* chain.draftCurrent(
          stored.request,
          DraftPurpose.Transfer({ from: stored.order.from }),
        );
      });

      const authorizing = Effect.fn("Wallet.authorizing")(function* (
        stored: Proposed,
        sealed: Sealed,
        mayRetry: boolean,
      ): Effect.fn.Return<TransferStep, StoreFailure | ChainUnreachable> {
        const authorized = yield* transfers.authorize(stored, sealed);

        const retried = () =>
          mayRetry ? authorizing(stored, sealed, false) : resumed(stored);

        return yield* Match.valueTags(authorized, {
          SlotTaken: ({ holder }) =>
            Effect.gen(function* () {
              const receipt = yield* reconcile(holder);

              return Predicate.isTagged(receipt, "Pending")
                ? new SenderBusy({ inFlight: receipt })
                : (yield* currentDraft(stored))
                  ? yield* resumed(stored)
                  : yield* redrafted(stored);
            }),
          ClaimablesFull: ({ limit }) =>
            Effect.gen(function* () {
              const full = yield* quotaFull(stored.order.from);

              return full
                ? new UnclaimedFundsLimitReached({ limit })
                : yield* retried();
            }),
          SlotOccupied: () =>
            Effect.gen(function* () {
              const busy = yield* assets.inFlightFor(stored.order.from);

              if (Option.isNone(busy)) return proposedStep(stored);

              if (yield* assetActions.reconcilePending(busy.value))
                return new AssetBusy({ inFlight: assetPending(busy.value) });

              return (yield* currentDraft(stored))
                ? yield* retried()
                : yield* redrafted(stored);
            }),
          WalletInactive: () => Effect.succeed(new NotOpened()),
          Proposed: (proposed) => resumed(proposed),
          Authorized: reconcile,
          Concluded: signedStep,
        });
      });

      const settling: TransferEffects = {
        settle: reconcile,
        recover: directory.recover,
        quota: quotaFull,
      };

      const transfer = Effect.fn("Wallet.transfer")(function* (
        order: TransferOrder,
        approval: Option.Option<Approval>,
      ): Effect.fn.Return<TransferStep, StoreFailure | ChainUnreachable> {
        const malformed = check.malformed(order);

        if (Option.isSome(malformed)) return malformed.value;

        const existing = yield* transfers.find(order.id);

        if (Option.isSome(existing)) {
          const stored = existing.value;

          if (
            Schema.encodeSync(OrderJson)(stored.order) !==
            Schema.encodeSync(OrderJson)(order)
          )
            return yield* new StoreFailure({
              cause: new Error("Transfer id cannot identify a different order"),
            });

          if (!Predicate.isTagged(stored, "Proposed"))
            return yield* signedStep(stored);

          const refusal = memoRefusal(order, stored.recipient);

          if (Option.isSome(refusal)) return refusal.value;

          if (!(yield* currentDraft(stored))) return yield* redrafted(stored);

          if (yield* live(stored.request)) {
            if (Option.isNone(approval)) return proposedStep(stored);

            const sealed = yield* chain
              .seal(stored.request, approval.value, stored.order.from)
              .pipe(Effect.option);

            if (Option.isNone(sealed)) return proposedStep(stored);

            if (!(yield* currentDraft(stored))) return yield* redrafted(stored);

            return yield* authorizing(stored, sealed.value, true);
          }
        }

        const examined = yield* check.examine(order, settling);

        if (!(examined instanceof Examined)) return examined;

        const request = yield* draft(order, examined.delivery);

        const proposed = yield* transfers.propose(
          order,
          examined.recipient,
          request,
          chain.unclaimedFundsCreatedBy(request),
        );

        return yield* resumed(proposed);
      });

      const heldBack = Effect.fn("Wallet.heldBackOverview")(function* (
        row: WalletRow,
      ): Effect.fn.Return<
        Option.Option<NotOpened | NeedsReopening>,
        StoreFailure | ChainUnreachable
      > {
        const bound =
          row.status === "recovered"
            ? Option.some(yield* directory.profile(row))
            : yield* directory.unopened(row);

        if (Option.isNone(bound)) return Option.some(new NotOpened());

        const profile = bound.value;

        const step = Option.isSome(sealedOpening(row))
          ? Option.some(yield* resume(profile))
          : Option.none();

        if (Option.exists(step, Predicate.isTagged("Opened")))
          return Option.none();

        return Option.some(
          row.status === "recovered" ||
            Option.exists(step, Predicate.isTagged("OpeningPending"))
            ? new NeedsReopening({ profile })
            : new NotOpened({ profile: bound }),
        );
      });

      const overview = Effect.fn("Wallet.overview")(function* (
        address: AccountAddress,
      ): Effect.fn.Return<Overview, StoreFailure | ChainUnreachable> {
        if (!chain.validAddress(address))
          return new InvalidAddress({ address });

        const found = yield* directory.byAddress(address);

        if (Option.isNone(found)) return new NotOpened();

        const active = found.value.status === "active";

        if (!active) {
          const shown = yield* heldBack(found.value);

          if (Option.isSome(shown)) return shown.value;
        }

        const row = active ? found : yield* directory.byAddress(address);

        if (Option.isNone(row) || row.value.status !== "active")
          return new NotOpened();

        const owner = yield* directory.profile(row.value);
        const latest = yield* transfers.latestFrom(address);

        const receipt: Option.Option<Receipt> = Option.isSome(latest)
          ? yield* Match.valueTags(latest.value, {
              Authorized: (held) =>
                reconcile(held).pipe(Effect.map(Option.some)),
              Concluded: (concluded) =>
                Effect.succeed(Option.some(concluded.receipt)),
              Proposed: () => Effect.succeed(Option.none()),
            })
          : Option.none();

        const balance = yield* readBalance(address);

        if (Option.isNone(balance)) {
          yield* directory.recover(row.value);

          return new NeedsReopening({ profile: owner });
        }

        return new Holding({
          profile: owner,
          ...(yield* portfolio(address)),
          latest: receipt,
        });
      });

      const records = {
        reconcileTransfer: (entry: Authorized) =>
          reconcile(entry).pipe(
            Effect.map((receipt) => Predicate.isTagged(receipt, "Pending")),
          ),
        reconcileOpening,
        reconcileAsset: assetActions.reconcilePending,
      };

      const sweep = yield* sweepFlow({
        ...records,
        closeGoneUnclaimedFunds: links.closeGoneUnclaimedFunds,
      });

      const { ingest } = yield* depositFlow;

      const scheduled = Effect.gen(function* () {
        const ingested = yield* ingest().pipe(Effect.exit);
        const swept = yield* sweep.pipe(Effect.exit);

        const failed = [ingested, swept].flatMap((exit) =>
          Exit.isFailure(exit) ? [exit.cause] : [],
        );

        yield* Effect.forEach(failed, (cause) =>
          Effect.logError("Scheduled run failed", Cause.pretty(cause)),
        );

        if (failed.length > 0)
          return yield* Effect.die(
            new Error(`${failed.length} scheduled tasks failed`),
          );
      });

      const attend = yield* workFlow(records);

      return Wallet.of({
        manage: (order, approval) => wrap(assetActions.manage(order, approval)),
        open: (claim, approval, humanCheck = Option.none()) =>
          wrap(open(claim, approval, humanCheck)),
        transfer: (order, approval) => wrap(transfer(order, approval)),
        overview: (address) => wrap(overview(address)),
        paymentLinks: (address) => wrap(links.paymentLinks(address)),
        activity: (address, before) => wrap(history(address, before)),
        paymentLink: (link) => wrap(assetActions.paymentLink(link)),
        claimPaymentLink: (order, approval) =>
          wrap(assetActions.claimPaymentLink(order, approval)),
        resolvePaymentLink: (sender, receipt) =>
          wrap(links.resolvePaymentLink(sender, receipt)),
        quotePayout: (link, currency) =>
          wrap(payouts.quotePayout(link, currency)),
        requestPayout: (order, approval) =>
          wrap(payouts.requestPayout(order, approval)),
        payout: (id) => wrap(payouts.payout(id)),
        restoreChallenge: () => wrap(backup.restoreChallenge()),
        enrollmentChallenge: (claim, humanCheck = Option.none()) =>
          wrap(backup.enrollmentChallenge(claim, humanCheck)),
        enroll: (enrollment, approvals) =>
          wrap(backup.enroll(enrollment, approvals)),
        restore: (assertion) => wrap(backup.restore(assertion)),
        sessionChallenge: () => wrap(backup.sessionChallenge()),
        beginSession: (assertion) => wrap(backup.beginSession(assertion)),
        assess: (address, intent) =>
          wrap(check.assess({ from: address, ...intent })),
        checkRecipient: (to) => wrap(check.checkRecipient(to)),
        sweep: wrap(sweep),
        ingestDeposits: wrap(ingest()),
        scheduled: wrap(scheduled),
        attend: (work, attempt) => wrap(attend(work, attempt)),
      });
    }),
  ).pipe(Layer.provideMerge(Principal.layer));
  static readonly layer = Wallet.serviceLayer.pipe(
    Layer.provide([
      Directory.layer,
      Transfers.layer,
      AssetOrders.layer,
      Backups.layer,
      Deposits.layer,
      chainLayer,
      HumanCheck.layer,
    ]),
  );
}
