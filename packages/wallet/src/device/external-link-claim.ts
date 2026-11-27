import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import {
  type Approval,
  AssetOrderId,
  ExternalLinkDraft,
  ExternalLinkOrder,
  ExternalLinkPending,
  type ExternalLinkStep,
  MemoNotAllowed,
  type WalletPort,
  type WalletUnavailable,
  forbidsMemo,
  sameAsset,
} from "../contract";
import type { ClaimIssue } from "./claim-reviews";
import { type LinkCode, linkAddressOf, opensLink } from "./link-code";
import { OpenedLink, openLink } from "./link-receive";
import {
  baseAccountOf,
  isIssuedBy,
  network,
  readDraft,
} from "../device-network";
import {
  DraftRejected,
  type ExternalLinkIntent,
  ExternalLinkReview,
  type LinkReceiveTarget,
  LinkCodeMismatch,
  type ReviewExternalLinkOutcome,
} from "./outcomes";
import { type DraftTiming, draftTiming } from "./payment-reviews";
import { pendingSteps, pollSchedule } from "./polling";
import { approveWithLinkCode } from "./signing";
import { sameMemo } from "./transfer-drafts";

const externalReviewJson = Schema.encodeSync(
  Schema.fromJsonString(ExternalLinkReview),
);

const externalReviewFromJson = Schema.decodeSync(
  Schema.fromJsonString(ExternalLinkReview),
);

export const externalReviewOf = (
  order: ExternalLinkOrder,
  draft: ExternalLinkDraft,
  redrafted: boolean,
  target: LinkReceiveTarget,
) => {
  const facts = readDraft(draft.request);

  if (
    Option.isNone(facts) ||
    !Predicate.isTagged(facts.value, "LinkReceiveFacts")
  )
    return Option.none();

  const receive = facts.value;
  const baseDestination = baseAccountOf(receive.destination);

  if (
    receive.link !== order.link ||
    order.link !== target.link ||
    receive.unclaimedFunds !== order.unclaimedFunds ||
    order.unclaimedFunds !== target.unclaimedFunds ||
    receive.destination !== order.destination ||
    baseDestination === receive.link ||
    receive.channel === receive.link ||
    receive.reserveSponsor === receive.link ||
    !sameAsset(receive.asset, target.asset) ||
    receive.amount !== target.amount ||
    isIssuedBy(receive.asset, baseDestination) ||
    (forbidsMemo(receive.destination) && receive.memo !== undefined) ||
    !sameMemo(receive.memo, order.memo) ||
    (draft.memoRequired && receive.memo === undefined)
  )
    return Option.none();

  return Option.some({
    maxTime: receive.maxTime,
    review: new ExternalLinkReview({
      order,
      draft,
      redrafted,
      network,
      link: target.link,
      unclaimedFunds: target.unclaimedFunds,
      destination: receive.destination,
      asset: target.asset,
      amount: target.amount,
      memo: receive.memo,
      memoRequired: draft.memoRequired,
      sender: target.sender,
    }),
  });
};

const externalStanding = (
  shown: ExternalLinkReview,
  nowMillis: number,
): DraftTiming => {
  const derived = externalReviewOf(
    shown.order,
    shown.draft,
    shown.redrafted,
    shown,
  );

  return Option.isNone(derived) ||
    externalReviewJson(derived.value.review) !== externalReviewJson(shown)
    ? "stale"
    : draftTiming(derived.value.maxTime, shown.draft.request, nowMillis);
};

export function deviceExternalLinkClaim<
  Refusal extends { readonly _tag: string } = never,
>(
  port: Pick<WalletPort, "paymentLink"> & {
    claimPaymentLink(
      order: ExternalLinkOrder,
      approval: Option.Option<Approval>,
    ): Effect.Effect<ExternalLinkStep | NoInfer<Refusal>, WalletUnavailable>;
  },
  state: Ref.Ref<ClaimIssue>,
) {
  type Outcome = ReviewExternalLinkOutcome | Refusal;

  type OnDraft = (
    draft: ExternalLinkDraft,
  ) => Effect.Effect<Option.Option<Outcome>>;

  interface ExternalTurn {
    readonly done: Option.Option<Outcome>;
    readonly pause: boolean;
  }

  const afterRelease: OnDraft = () =>
    Effect.succeed(Option.some(new DraftRejected()));

  const standingNow = (shown: ExternalLinkReview) =>
    Effect.map(DateTime.now, (now) =>
      externalStanding(shown, DateTime.toEpochMillis(now)),
    );

  const startPreflight = Ref.modify(state, (current) => [
    current.ticket + 1,
    { ticket: current.ticket + 1, issued: Option.none() },
  ]);

  const publish = (ticket: number, snapshot: string) =>
    Ref.modify(state, (current) =>
      current.ticket === ticket
        ? [true, { ticket, issued: Option.some(snapshot) }]
        : [false, current],
    );

  const consume = (snapshot: string) =>
    Ref.modify(state, (current) =>
      Option.contains(current.issued, snapshot)
        ? [true, { ticket: current.ticket, issued: Option.none() }]
        : [false, current],
    );

  const advance = (
    order: ExternalLinkOrder,
    onDraft: OnDraft,
    released: Option.Option<Approval> = Option.none(),
  ): Effect.Effect<Outcome, WalletUnavailable> =>
    Effect.gen(function* () {
      let approval = released;
      let attempts = 0;

      const step: Effect.Effect<ExternalTurn, WalletUnavailable> = Effect.gen(
        function* () {
          const submitted = Option.isSome(approval);

          attempts++;

          const response = yield* port.claimPaymentLink(order, approval);

          approval = Option.none();

          if (response instanceof ExternalLinkDraft)
            return {
              done: yield* onDraft(response),
              pause: false,
            };

          if (response instanceof ExternalLinkPending)
            return {
              done:
                attempts >= pendingSteps
                  ? Option.some<Outcome>(response)
                  : Option.none(),
              pause: !submitted,
            };

          return { done: Option.some<Outcome>(response), pause: false };
        },
      );

      const last = yield* Effect.repeat(step, {
        schedule: pollSchedule<ExternalTurn>(
          (turn) => Option.isNone(turn.done),
          (turn) => turn.pause,
        ),
      });

      return Option.getOrElse(last.done, (): Outcome => new DraftRejected());
    });

  const presenting = (
    order: ExternalLinkOrder,
    target: LinkReceiveTarget,
    redrafted: boolean,
    ticket: number,
  ): OnDraft => {
    let refreshed = false;

    return (draft) =>
      Effect.gen(function* (): Effect.fn.Return<Option.Option<Outcome>> {
        const derived = externalReviewOf(
          order,
          draft,
          redrafted || refreshed,
          target,
        );

        if (Option.isNone(derived)) return Option.some(new DraftRejected());

        const standing = yield* standingNow(derived.value.review);

        if (standing === "expiring" && !refreshed && !redrafted) {
          refreshed = true;

          return Option.none();
        }

        if (
          standing !== "current" ||
          !(yield* publish(ticket, externalReviewJson(derived.value.review)))
        )
          return Option.some(new DraftRejected());

        return Option.some(derived.value.review);
      });
  };

  const redraft = (snapshot: string, shown: ExternalLinkReview) =>
    Ref.modify(state, (current): [Option.Option<number>, ClaimIssue] =>
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
              presenting(shown.order, shown, true, ticket.value),
            )
          : Effect.succeed(new DraftRejected()),
      ),
    );

  const review = Effect.fn("Device.reviewExternalLinkClaim")(function* (
    code: LinkCode,
    intent: ExternalLinkIntent,
  ): Effect.fn.Return<Outcome, WalletUnavailable> {
    if (Option.isNone(linkAddressOf(code))) return new LinkCodeMismatch();

    if (forbidsMemo(intent.destination) && intent.memo !== undefined)
      return new MemoNotAllowed({ reason: "muxed" });

    const target = yield* openLink(port, code);

    if (!(target instanceof OpenedLink)) return target;

    const order = new ExternalLinkOrder({
      id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
      link: target.link,
      unclaimedFunds: target.unclaimedFunds,
      destination: intent.destination,
      memo: intent.memo,
    });

    const ticket = yield* startPreflight;

    return yield* advance(order, presenting(order, target, false, ticket));
  });

  const confirm = Effect.fn("Device.confirmExternalLinkClaim")(function* (
    shown: ExternalLinkReview,
    code: LinkCode,
  ): Effect.fn.Return<Outcome, WalletUnavailable> {
    if (!opensLink(code, shown.link)) return new LinkCodeMismatch();

    const { issued: snapshot } = yield* Ref.get(state);

    if (Option.isNone(snapshot) || snapshot.value !== externalReviewJson(shown))
      return new DraftRejected();

    const presented = externalReviewFromJson(snapshot.value);
    const standing = yield* standingNow(presented);

    if (standing === "expiring")
      return yield* redraft(snapshot.value, presented);

    if (standing !== "current") return new DraftRejected();

    if (!(yield* consume(snapshot.value))) return new DraftRejected();

    const [approval] = approveWithLinkCode(code, [presented.draft.request]);

    return yield* advance(presented.order, afterRelease, Option.some(approval));
  });

  return { review, confirm };
}
