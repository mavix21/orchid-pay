import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import {
  type AssetOrder,
  RecipientCannotReceive,
  type WalletPort,
  baseAsset,
  needsTrustline,
  sameAsset,
} from "../contract";
import { type LinkCode } from "./link-code";
import { claimStanding } from "./claim-reviews";
import type {
  EnrollWalletOutcome,
  EnrollmentPending,
  ReviewEnrollmentReceiveOutcome,
} from "./enrollment-records";
import { type Awaiting, addressOf, usernameOf } from "./enrollment-state";
import { PublicDeviceWallet } from "./key-store";
import {
  OpenedLink,
  linkReceiveKind,
  openLink,
  receiveOrder,
  receiveReviewOf,
} from "./link-receive";
import { reserveSponsorOf } from "./opening-drafts";
import {
  DraftRejected,
  type LinkReceiveReview,
  type LinkReceiveTarget,
} from "./outcomes";

export interface ReceiveSlot {
  review: Option.Option<LinkReceiveReview>;
}

export const enrollmentReceive = (
  port: Pick<WalletPort, "manage" | "paymentLink">,
  slot: ReceiveSlot,
  pendingNotice: (current: Awaiting) => EnrollmentPending,
) => {
  const candidateWallet = (current: Awaiting) =>
    Option.flatMap(current.review, (review) =>
      Option.map(
        reserveSponsorOf(review.draft),
        (reserveSponsor) =>
          new PublicDeviceWallet({
            address: addressOf(current),
            username: usernameOf(current),
            reserveSponsor,
          }),
      ),
    );

  const receiveStanding = Effect.fn("Device.enrollmentReceiveStanding")(
    function* (current: Awaiting, shown: LinkReceiveReview) {
      const wallet = candidateWallet(current);
      const now = DateTime.toEpochMillis(yield* DateTime.now);

      return Option.isNone(wallet)
        ? "stale"
        : claimStanding(linkReceiveKind, wallet.value, shown, now);
    },
  );

  const draftReceive = Effect.fn("Device.draftEnrollmentReceive")(function* (
    current: Awaiting,
    order: AssetOrder,
    target: LinkReceiveTarget,
    redrafted: boolean,
  ): Effect.fn.Return<ReviewEnrollmentReceiveOutcome> {
    const wallet = candidateWallet(current);

    if (Option.isNone(wallet)) return pendingNotice(current);

    const step = yield* port.manage(order, Option.none()).pipe(Effect.result);

    if (Result.isFailure(step)) return step.failure;

    if (!Predicate.isTagged(step.success, "AssetDraft")) return step.success;

    const derived = receiveReviewOf(
      wallet.value,
      order,
      step.success,
      redrafted,
      target,
    );

    if (Option.isNone(derived)) return new DraftRejected();

    if ((yield* receiveStanding(current, derived.value.review)) !== "current")
      return new DraftRejected();

    slot.review = Option.some(derived.value.review);

    return pendingNotice(current);
  });

  const refreshReceive = (current: Awaiting, shown: LinkReceiveReview) =>
    draftReceive(current, shown.order, shown, true).pipe(
      Effect.map((outcome): EnrollWalletOutcome =>
        Predicate.isTagged(outcome, "EnrollmentPending")
          ? outcome
          : new DraftRejected(),
      ),
    );

  const reviewOpenLink = Effect.fn("Device.reviewEnrollmentLink")(function* (
    current: Awaiting,
    code: LinkCode,
  ): Effect.fn.Return<ReviewEnrollmentReceiveOutcome> {
    const opened = yield* openLink(port, code).pipe(Effect.result);

    if (Result.isFailure(opened)) return opened.failure;

    const target = opened.success;

    if (!(target instanceof OpenedLink)) return target;

    if (needsTrustline(target.asset) && !sameAsset(target.asset, baseAsset))
      return new RecipientCannotReceive({
        address: addressOf(current),
        reason: "no_trustline",
      });

    const order = Option.match(slot.review, {
      onNone: () => receiveOrder(addressOf(current), target),
      onSome: (held) =>
        held.link === target.link &&
        held.unclaimedFunds === target.unclaimedFunds &&
        held.order.wallet === addressOf(current)
          ? held.order
          : receiveOrder(addressOf(current), target),
    });

    return yield* draftReceive(current, order, target, false);
  });

  return { receiveStanding, refreshReceive, reviewOpenLink };
};
