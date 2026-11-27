import type * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import type {
  Approval,
  AssetDraft,
  AssetOrder,
  SigningRequest,
  WalletPort,
  WalletUnavailable,
} from "../contract";
import type {
  CorruptDeviceWallet,
  KeyStoreUnavailable,
  PublicDeviceWallet,
  SealedDevice,
} from "./key-store";
import {
  DraftRejected,
  NoWallet,
  type ReclaimOutcome,
  UnsupportedDevice,
} from "./outcomes";
import { type DraftTiming, draftTiming } from "./payment-reviews";
import { pendingSteps, pollSchedule } from "./polling";
import {
  type ApprovalWithheld,
  Reserved,
  approveReviewed,
} from "./reviewed-approval";

export interface ClaimIssue {
  readonly ticket: number;
  readonly issued: Option.Option<string>;
}

export interface ClaimReviews {
  readonly state: Ref.Ref<ClaimIssue>;
  readonly device: SealedDevice | undefined;
}

export interface ShownClaim {
  readonly order: AssetOrder;
  readonly draft: AssetDraft;
  readonly redrafted: boolean;
}

export interface ClaimKind<T, V extends ShownClaim> {
  readonly reviewOf: (
    wallet: PublicDeviceWallet,
    order: AssetOrder,
    draft: AssetDraft,
    redrafted: boolean,
    target: T,
  ) => Option.Option<{ readonly maxTime: number; readonly review: V }>;
  readonly targetOf: (shown: V) => T;
  readonly json: (review: V) => string;
  readonly fromJson: (json: string) => V;
  readonly concluded: (
    order: AssetOrder,
    outcome: ReclaimOutcome | V,
  ) => Effect.Effect<void, KeyStoreUnavailable>;
}

export const claimStanding = <T, V extends ShownClaim>(
  kind: ClaimKind<T, V>,
  wallet: PublicDeviceWallet,
  shown: V,
  nowMillis: number,
): DraftTiming => {
  const derived = kind.reviewOf(
    wallet,
    shown.order,
    shown.draft,
    shown.redrafted,
    kind.targetOf(shown),
  );

  return Option.isNone(derived) ||
    kind.json(derived.value.review) !== kind.json(shown)
    ? "stale"
    : draftTiming(derived.value.maxTime, shown.draft.request, nowMillis);
};

export type Signer = (
  requests: Arr.NonEmptyReadonlyArray<SigningRequest>,
) => Arr.NonEmptyReadonlyArray<Approval>;

interface ClaimTurn<V> {
  readonly done: Option.Option<ReclaimOutcome | V>;
  readonly pause: boolean;
}

export function reviewedClaims<T, V extends ShownClaim>(
  port: WalletPort,
  reviews: ClaimReviews,
  kind: ClaimKind<T, V>,
) {
  type Outcome = ReclaimOutcome | V;

  type OnDraft = (draft: AssetDraft) => Effect.Effect<Option.Option<Outcome>>;

  const afterRelease: OnDraft = () =>
    Effect.succeed(Option.some(new DraftRejected()));

  const standingNow = (wallet: PublicDeviceWallet, shown: V) =>
    Effect.map(DateTime.now, (now) =>
      claimStanding(kind, wallet, shown, DateTime.toEpochMillis(now)),
    );

  const advance = (
    order: AssetOrder,
    onDraft: OnDraft,
    released: Option.Option<Approval> = Option.none(),
  ): Effect.Effect<Outcome, WalletUnavailable | KeyStoreUnavailable> =>
    Effect.gen(function* () {
      let approval = released;
      let attempts = 0;

      const step: Effect.Effect<ClaimTurn<V>, WalletUnavailable> = Effect.gen(
        function* () {
          const submitted = Option.isSome(approval);

          attempts++;

          const response = yield* port.manage(order, approval);

          approval = Option.none();

          return yield* Match.value(response).pipe(
            Match.tag("AssetDraft", (draft) =>
              Effect.map(onDraft(draft), (done): ClaimTurn<V> => ({
                done,
                pause: false,
              })),
            ),
            Match.tag("AssetPending", (pending) =>
              Effect.succeed<ClaimTurn<V>>({
                done:
                  attempts >= pendingSteps
                    ? Option.some(pending)
                    : Option.none(),
                pause: !submitted,
              }),
            ),
            Match.orElse((outcome: ReclaimOutcome) =>
              Effect.succeed<ClaimTurn<V>>({
                done: Option.some(outcome),
                pause: false,
              }),
            ),
          );
        },
      );

      const last = yield* Effect.repeat(step, {
        schedule: pollSchedule<ClaimTurn<V>>(
          (turn) => Option.isNone(turn.done),
          (turn) => turn.pause,
        ),
      });

      const outcome = Option.getOrElse(
        last.done,
        (): Outcome => new DraftRejected(),
      );

      yield* kind.concluded(order, outcome);

      return outcome;
    });

  const startPreflight = Ref.modify(reviews.state, (current) => [
    current.ticket + 1,
    { ticket: current.ticket + 1, issued: Option.none() },
  ]);

  const publish = (ticket: number, snapshot: string) =>
    Ref.modify(reviews.state, (current) =>
      current.ticket === ticket
        ? [true, { ticket, issued: Option.some(snapshot) }]
        : [false, current],
    );

  const consume = (snapshot: string) =>
    Ref.modify(reviews.state, (current) =>
      Option.contains(current.issued, snapshot)
        ? [true, { ticket: current.ticket, issued: Option.none() }]
        : [false, current],
    );

  const presenting = (
    wallet: PublicDeviceWallet,
    order: AssetOrder,
    target: T,
    redrafted: boolean,
    ticket: number,
  ): OnDraft => {
    let refreshed = false;

    return (draft) =>
      Effect.gen(function* (): Effect.fn.Return<Option.Option<Outcome>> {
        const derived = kind.reviewOf(
          wallet,
          order,
          draft,
          redrafted || refreshed,
          target,
        );

        if (Option.isNone(derived)) return Option.some(new DraftRejected());

        const standing = yield* standingNow(wallet, derived.value.review);

        if (standing === "expiring" && !refreshed && !redrafted) {
          refreshed = true;

          return Option.none();
        }

        if (
          standing !== "current" ||
          !(yield* publish(ticket, kind.json(derived.value.review)))
        )
          return Option.some(new DraftRejected());

        return Option.some(derived.value.review);
      });
  };

  const review = Effect.fn("Device.reviewClaim")(function* (
    wallet: PublicDeviceWallet,
    order: AssetOrder,
    target: T,
  ): Effect.fn.Return<Outcome, WalletUnavailable | KeyStoreUnavailable> {
    const ticket = yield* startPreflight;

    return yield* advance(
      order,
      presenting(wallet, order, target, false, ticket),
    );
  });

  const redraft = (snapshot: string, wallet: PublicDeviceWallet, shown: V) =>
    Ref.modify(reviews.state, (current): [Option.Option<number>, ClaimIssue] =>
      Option.contains(current.issued, snapshot)
        ? [
            Option.some(current.ticket + 1),
            { ticket: current.ticket + 1, issued: Option.none() },
          ]
        : [Option.none(), current],
    ).pipe(
      Effect.flatMap((ticket): ReturnType<typeof advance> =>
        Option.isSome(ticket) && !shown.redrafted
          ? advance(
              shown.order,
              presenting(
                wallet,
                shown.order,
                kind.targetOf(shown),
                true,
                ticket.value,
              ),
            )
          : Effect.succeed(new DraftRejected()),
      ),
    );

  const confirm = Effect.fn("Device.confirmClaim")(function* (
    shown: V,
    sign?: Signer,
  ): Effect.fn.Return<
    Outcome | ApprovalWithheld | UnsupportedDevice,
    WalletUnavailable | KeyStoreUnavailable | CorruptDeviceWallet
  > {
    const { device } = reviews;

    if (device === undefined) return new UnsupportedDevice();

    const { issued: snapshot } = yield* Ref.get(reviews.state);

    if (Option.isNone(snapshot) || snapshot.value !== kind.json(shown))
      return new DraftRejected();

    const presented = kind.fromJson(snapshot.value);

    const issuedHere = Effect.map(Ref.get(reviews.state), (current) =>
      Option.contains(current.issued, snapshot.value),
    );

    const sealed = yield* device.store.readSealed();

    if (Option.isNone(sealed)) return new NoWallet();

    const record = sealed.value;
    const observed = record.public;
    let released = false;

    if ((yield* standingNow(observed, presented)) === "expiring")
      return yield* redraft(snapshot.value, observed, presented);

    const approved = yield* approveReviewed<
      PublicDeviceWallet,
      never,
      Outcome,
      never,
      WalletUnavailable | KeyStoreUnavailable
    >(device, {
      record,
      requests: [presented.draft.request],
      sign,
      holds: (wallet) =>
        Effect.zipWith(
          standingNow(wallet, presented),
          issuedHere,
          (standing, current) => current && standing === "current",
        ),
      reserve: (wallet) =>
        Effect.succeed(new Reserved({ reservation: wallet })),
      unreserve: () => Effect.void,
      release: ([approval], reservation) =>
        Effect.gen(function* () {
          if ((yield* standingNow(reservation, presented)) !== "current")
            return new DraftRejected();

          if (!(yield* consume(snapshot.value))) return new DraftRejected();

          released = true;

          return yield* advance(
            presented.order,
            afterRelease,
            Option.some(approval),
          );
        }),
    });

    if (!released && Predicate.isTagged(approved, "DraftRejected")) {
      const latest = yield* device.store.readPublic();

      return Option.isSome(latest) &&
        (yield* standingNow(latest.value, presented)) === "expiring"
        ? yield* redraft(snapshot.value, latest.value, presented)
        : approved;
    }

    return approved;
  });

  return { review, confirm };
}
