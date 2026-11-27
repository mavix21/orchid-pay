import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  type Approval,
  type Failed,
  type Settled,
  TransferId,
  TransferOrder,
  type WalletPort,
  type WalletUnavailable,
  type TransferIntent,
} from "../contract";
import {
  type CorruptDeviceWallet,
  type KeyStore,
  type KeyStoreUnavailable,
  type PublicDeviceWallet,
  type SealedDevice,
  type SealedDeviceWallet,
} from "./key-store";
import { SealedLinkCode } from "./link-seal";
import {
  ApprovalOutstanding,
  type ConfirmOutcome,
  DraftRejected,
  NoTransfer,
  NoWallet,
  PaymentReview,
  type ResumeOutcome,
  type SendOutcome,
  UnsupportedDevice,
} from "./outcomes";
import {
  type DraftHandler,
  type ObserveDraft,
  observeDraft,
} from "./draft-handlers";
import { pendingSteps, pollSchedule } from "./polling";
import {
  draftTiming,
  reviewFromJson,
  reviewJson,
  reviewOf,
  standingNow,
} from "./payment-reviews";
import { type Reserved, approveReviewed } from "./reviewed-approval";
import { claimOrderSlot, forgetOrder } from "./order-slots";
import { recordsStore } from "./saved-links";
import type { TransferRoute } from "./transfer-route";
import {
  type FundingReservation,
  reserveApproval,
  withdrawReservation,
} from "./transfer-reservation";
import {
  approvalOutstanding,
  matchesIntent,
  orderJson,
  orderRevision,
  orderedFacts,
  sameOrderSlot,
} from "./transfer-drafts";

const followAfterExpiry = { minutes: 2 };

const nowSeconds = Effect.map(DateTime.now, (now) =>
  Math.floor(DateTime.toEpochMillis(now) / 1000),
);

interface SendTurn<D> {
  readonly done: Option.Option<D | SendOutcome>;
  readonly pause: boolean;
}

export interface LinkSaving<W> {
  readonly input: Uint8Array<ArrayBuffer>;
  readonly seal: (
    record: SealedDeviceWallet,
    output: Option.Option<Redacted.Redacted<Uint8Array<ArrayBuffer>>>,
  ) => Effect.Effect<SealedLinkCode | W>;
}

export interface Reviews {
  readonly issued: Ref.Ref<Option.Option<string>>;
  readonly device: SealedDevice | undefined;
}

export function sendTransfer<R>(
  port: WalletPort,
  route: TransferRoute<R>,
  store: KeyStore,
  reviews?: Reviews,
) {
  const records = recordsStore(store, reviews?.device?.store);

  const advance = <D>(
    initial: PublicDeviceWallet,
    order: TransferOrder,
    onDraft: DraftHandler<D>,
    released: Option.Option<Approval> = Option.none(),
    refusedBeforeRelease: Effect.Effect<void> = Effect.void,
  ): Effect.Effect<
    D | R | SendOutcome,
    WalletUnavailable | KeyStoreUnavailable
  > =>
    Effect.gen(function* () {
      let wallet = initial;
      let approval = released;
      let refreshed = false;
      let attempts = 0;

      const step: Effect.Effect<
        SendTurn<D | R>,
        WalletUnavailable | KeyStoreUnavailable
      > = Effect.gen(function* () {
        const submitted = Option.isSome(approval);

        attempts++;

        const attempt = route.transfer(order, approval);

        const answered = yield* submitted
          ? attempt.pipe(
              Effect.tapErrorTag(
                ["SessionRequired", "RateLimited"],
                () => refusedBeforeRelease,
              ),
            )
          : attempt;

        approval = Option.none();

        if (Result.isFailure(answered)) {
          if (submitted) yield* refusedBeforeRelease;

          return { done: Option.some(answered.failure), pause: false };
        }

        return yield* Match.valueTags(answered.success, {
          TransferDraft: (draft) =>
            onDraft(
              wallet,
              order,
              draft,
              attempts >= pendingSteps,
              refreshed,
            ).pipe(
              Effect.map((decision): SendTurn<D> => {
                if (decision.next) {
                  wallet = decision.next.wallet;
                  approval = decision.next.approval;
                  refreshed = decision.next.refreshed;
                }

                return { done: decision.done, pause: false };
              }),
            ),
          Pending: (pending) =>
            Effect.succeed<SendTurn<D>>({
              done:
                attempts >= pendingSteps ? Option.some(pending) : Option.none(),
              pause: !submitted,
            }),
          Settled: (settled) =>
            forgetOrder(records, wallet.address, order, settled).pipe(
              Effect.as<SendTurn<D>>({
                done: Option.some(settled),
                pause: false,
              }),
            ),
          Failed: (failed) =>
            forgetOrder(records, wallet.address, order, failed).pipe(
              Effect.as<SendTurn<D>>({
                done: Option.some(failed),
                pause: false,
              }),
            ),
          NotOpened: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          UnknownRecipient: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          PhoneNotSupported: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          InsufficientBalance: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          SenderBusy: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          InvalidAddress: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          ExternalMemoRequired: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          MemoNotAllowed: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          RecipientCannotReceive: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          UnclaimedFundsLimitReached: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          AssetUnsupported: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
          AssetBusy: (outcome) =>
            Effect.succeed({ done: Option.some(outcome), pause: false }),
        });
      });

      const last = yield* Effect.repeat(step, {
        schedule: pollSchedule<SendTurn<D | R>>(
          (turn) => Option.isNone(turn.done),
          (turn) => turn.pause,
        ),
      });

      return Option.getOrElse(last.done, () => new DraftRejected());
    });

  const presenting =
    (redrafted: boolean): DraftHandler<PaymentReview | DraftRejected> =>
    (wallet, order, draft, _finalStep, refreshed) =>
      Effect.gen(function* () {
        const fresh = redrafted || refreshed;
        const derived = reviewOf(wallet, order, draft, fresh);

        if (Option.isNone(derived))
          return { done: Option.some(new DraftRejected()) };

        const timing = draftTiming(
          derived.value.facts.maxTime,
          draft.request,
          DateTime.toEpochMillis(yield* DateTime.now),
        );

        if (timing === "expiring" && !fresh)
          return {
            done: Option.none(),
            next: { wallet, approval: Option.none(), refreshed: true },
          };

        if (timing !== "current")
          return { done: Option.some(new DraftRejected()) };

        if (reviews !== undefined)
          yield* Ref.set(
            reviews.issued,
            Option.some(reviewJson(derived.value.review)),
          );

        return { done: Option.some(derived.value.review) };
      });

  const observing: ObserveDraft<ApprovalOutstanding | NoTransfer> = (
    wallet,
    order,
  ) =>
    Effect.map(nowSeconds, (now) =>
      approvalOutstanding(wallet, now)
        ? new ApprovalOutstanding({ order })
        : new NoTransfer(),
    );

  const prepared = <D>(
    intent: TransferIntent,
    onDraft: DraftHandler<D>,
  ): Effect.Effect<
    D | R | SendOutcome,
    WalletUnavailable | KeyStoreUnavailable
  > =>
    Effect.gen(function* () {
      const stored = yield* store.readPublic();

      if (Option.isNone(stored)) return new NoWallet();

      let observed = stored.value;
      const address = observed.address;

      for (let attempt = 0; attempt < 2; attempt++) {
        if (
          matchesIntent(observed, intent, route.paymentRequest) &&
          observed.transfer !== undefined
        )
          return yield* advance(observed, observed.transfer, onDraft);

        let reconciled = false;
        let concluded = Option.none<Settled | Failed>();

        if (
          observed.transfer !== undefined &&
          observed.approvedUntil !== undefined
        ) {
          const signed = yield* port.transfer(observed.transfer, Option.none());
          const now = yield* nowSeconds;

          const resolved =
            Predicate.isTagged(signed, "Settled") ||
            Predicate.isTagged(signed, "Failed") ||
            (!Predicate.isTagged(signed, "Pending") &&
              !approvalOutstanding(observed, now));

          if (!resolved)
            return new ApprovalOutstanding({ order: observed.transfer });

          reconciled = true;

          if (
            Predicate.isTagged(signed, "Settled") ||
            Predicate.isTagged(signed, "Failed")
          )
            concluded = Option.some(signed);
        }

        const candidate = new TransferOrder({
          ...intent,
          id: Schema.decodeSync(TransferId)(crypto.randomUUID()),
          from: address,
        });

        const claimed = yield* claimOrderSlot(records, {
          expected: observed,
          intent,
          paymentRequest: route.paymentRequest,
          candidate,
          reconciled,
          concluded,
        });

        if (Option.isNone(claimed)) return new NoWallet();

        const wallet = claimed.value.records.wallet;

        if (wallet.address !== address) return new UnsupportedDevice();

        if (
          matchesIntent(wallet, intent, route.paymentRequest) &&
          wallet.transfer !== undefined
        )
          return yield* advance(wallet, wallet.transfer, onDraft);

        if (
          wallet.transfer !== undefined &&
          wallet.approvedUntil !== undefined &&
          observed.transfer !== undefined &&
          wallet.transfer.id === observed.transfer.id &&
          orderRevision(wallet) === orderRevision(observed)
        ) {
          if (attempt === 0) {
            observed = wallet;
            continue;
          }

          return new ApprovalOutstanding({ order: wallet.transfer });
        }

        return new DraftRejected();
      }

      return new DraftRejected();
    });

  const reviewing = (funding: boolean, intent: TransferIntent) =>
    Predicate.isTagged(intent.to, "PaymentLink") === funding
      ? prepared(intent, presenting(false))
      : Effect.succeed(new DraftRejected());

  const review = Effect.fn("Device.review")(function* (intent: TransferIntent) {
    return yield* reviewing(false, intent);
  });

  const reviewLinkFunding = Effect.fn("Device.reviewLinkFunding")(function* (
    intent: TransferIntent,
  ) {
    return yield* reviewing(true, intent);
  });

  const observed = (wallet: PublicDeviceWallet, id: TransferId) =>
    wallet.transfer?.id === id &&
    wallet.paymentRequest === route.paymentRequest &&
    wallet.approvedUntil !== undefined
      ? advance(wallet, wallet.transfer, observeDraft(observing))
      : Effect.succeed(new NoTransfer());

  const recorded = (address: AccountAddress, id: TransferId) =>
    port
      .overview(address)
      .pipe(
        Effect.map((overview) =>
          Predicate.isTagged(overview, "Holding")
            ? Option.filter(overview.latest, (receipt) => receipt.id === id)
            : Option.none(),
        ),
      );

  const observedNow = (id: TransferId) =>
    store
      .readPublic()
      .pipe(
        Effect.flatMap((current) =>
          Option.isSome(current)
            ? observed(current.value, id)
            : Effect.succeed(new NoWallet()),
        ),
      );

  const following = (id: TransferId) =>
    observedNow(id).pipe(
      Effect.repeat({
        while: (answered) =>
          Predicate.isTagged(answered, "Pending")
            ? Effect.map(DateTime.now, (now) =>
                DateTime.isLessThanOrEqualTo(
                  now,
                  DateTime.add(answered.expiresAt, followAfterExpiry),
                ),
              )
            : false,
      }),
    );

  const resume = Effect.fn("Device.resume")(function* (
    id: TransferId,
  ): Effect.fn.Return<
    ResumeOutcome | R,
    WalletUnavailable | KeyStoreUnavailable
  > {
    const stored = yield* store.readPublic();

    if (Option.isNone(stored)) return new NoWallet();

    const answered = yield* following(id);

    if (!Predicate.isTagged(answered, "NoTransfer")) return answered;

    return Option.getOrElse(
      yield* recorded(stored.value.address, id),
      (): ResumeOutcome | R => answered,
    );
  });

  const redraft = (
    issued: Ref.Ref<Option.Option<string>>,
    snapshot: string,
    wallet: PublicDeviceWallet,
    order: TransferOrder,
    review: PaymentReview,
  ) =>
    Ref.modify(issued, (current) =>
      Option.contains(current, snapshot)
        ? [true, Option.none()]
        : [false, current],
    ).pipe(
      Effect.flatMap((consumed) =>
        consumed && !review.redrafted
          ? advance(wallet, order, presenting(true))
          : Effect.succeed(new DraftRejected()),
      ),
    );

  const confirmReviewed = Effect.fn("Device.confirmReviewed")(function* <W>(
    shown: PaymentReview,
    saving: LinkSaving<W> | undefined,
  ): Effect.fn.Return<
    ConfirmOutcome | R | W,
    WalletUnavailable | KeyStoreUnavailable | CorruptDeviceWallet
  > {
    if (reviews?.device === undefined) return new UnsupportedDevice();

    const { device, issued } = reviews;
    const snapshot = yield* Ref.get(issued);

    if (Option.isNone(snapshot) || snapshot.value !== reviewJson(shown))
      return new DraftRejected();

    const presented = reviewFromJson(snapshot.value);

    const issuedHere = Effect.map(Ref.get(issued), (current) =>
      Option.contains(current, snapshot.value),
    );

    const sealed = yield* device.store.readSealed();

    if (Option.isNone(sealed)) return new NoWallet();

    const record = sealed.value;
    const observed = record.public;
    const order = observed.transfer;

    if (
      order === undefined ||
      observed.paymentRequest !== route.paymentRequest ||
      orderJson(order) !== orderJson(presented.order)
    )
      return new DraftRejected();

    if (approvalOutstanding(observed, yield* nowSeconds))
      return new ApprovalOutstanding({ order });

    const facts = orderedFacts(observed, order, presented.draft);

    if (Option.isNone(facts)) return new DraftRejected();

    if ((yield* standingNow(observed, presented)) === "expiring")
      return yield* redraft(issued, snapshot.value, observed, order, presented);

    const approved = yield* approveReviewed<
      FundingReservation,
      W | ApprovalOutstanding | DraftRejected | NoWallet,
      SendOutcome | NoTransfer | R,
      KeyStoreUnavailable | CorruptDeviceWallet,
      WalletUnavailable | KeyStoreUnavailable
    >(device, {
      record,
      requests: [presented.draft.request],
      operationInput: saving?.input,
      holds: (wallet) =>
        Effect.zipWith(
          standingNow(wallet, presented),
          issuedHere,
          (standing, issued) =>
            issued && sameOrderSlot(wallet, observed) && standing === "current",
        ),
      reserve: (wallet, output) =>
        saving === undefined
          ? reserveApproval(device.store, wallet, order, facts.value)
          : saving
              .seal(record, output)
              .pipe(
                Effect.flatMap(
                  (
                    sealedLink,
                  ): Effect.Effect<
                    | Reserved<FundingReservation>
                    | W
                    | ApprovalOutstanding
                    | DraftRejected
                    | NoWallet,
                    KeyStoreUnavailable | CorruptDeviceWallet
                  > =>
                    sealedLink instanceof SealedLinkCode
                      ? reserveApproval(
                          device.store,
                          wallet,
                          order,
                          facts.value,
                          Option.some(sealedLink),
                        )
                      : Effect.succeed(sealedLink),
                ),
              ),
      unreserve: (reservation) =>
        withdrawReservation(device.store, reservation, observed),
      release: ([approval], reservation) =>
        advance(
          reservation.wallet,
          order,
          observeDraft(observing),
          Option.some(approval),
          Effect.ignore(
            withdrawReservation(device.store, reservation, observed),
          ),
        ),
    });

    if (Predicate.isTagged(approved, "DraftRejected")) {
      const latest = yield* device.store.readPublic();

      return Option.isSome(latest) &&
        sameOrderSlot(latest.value, observed) &&
        (yield* standingNow(latest.value, presented)) === "expiring"
        ? yield* redraft(issued, snapshot.value, latest.value, order, presented)
        : approved;
    }

    return Predicate.isTagged(approved, "Pending")
      ? yield* resume(order.id)
      : approved;
  });

  const confirm = (shown: PaymentReview) =>
    Predicate.isTagged(shown.order.to, "PaymentLink")
      ? Effect.succeed(new DraftRejected())
      : confirmReviewed<never>(shown, undefined);

  const confirmLinkFunding = <W>(
    shown: PaymentReview,
    saving: LinkSaving<W> | undefined,
  ) =>
    Predicate.isTagged(shown.order.to, "PaymentLink")
      ? confirmReviewed(shown, saving)
      : Effect.succeed(new DraftRejected());

  return { review, confirm, resume, reviewLinkFunding, confirmLinkFunding };
}
