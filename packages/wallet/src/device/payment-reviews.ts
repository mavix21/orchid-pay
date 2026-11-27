import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { SigningRequest, TransferDraft, TransferOrder } from "../contract";
import { approvalMargin, draftLifetime } from "../policy";
import type { PublicDeviceWallet } from "./key-store";
import {
  type ClaimableFacts,
  type PaymentFacts,
  type PaymentLinkFacts,
  network,
} from "../device-network";
import { PaymentReview } from "./outcomes";
import {
  approvalOutstanding,
  clockAllowance,
  orderJson,
  orderedFacts,
} from "./transfer-drafts";

export const reviewJson = Schema.encodeSync(
  Schema.fromJsonString(PaymentReview),
);

export const reviewFromJson = Schema.decodeSync(
  Schema.fromJsonString(PaymentReview),
);

export type DraftTiming = "current" | "expiring" | "stale";

const approvalDeadline = (maxTime: number, request: SigningRequest) =>
  Math.min(maxTime * 1000, DateTime.toEpochMillis(request.expiresAt));

export const draftTiming = (
  maxTime: number,
  request: SigningRequest,
  nowMillis: number,
): DraftTiming => {
  if (maxTime > Math.floor(nowMillis / 1000) + draftLifetime + clockAllowance)
    return "stale";

  const deadline = approvalDeadline(maxTime, request);

  return deadline - nowMillis >= approvalMargin * 1000 ? "current" : "expiring";
};

const reviewFrom = (
  order: TransferOrder,
  draft: TransferDraft,
  redrafted: boolean,
  facts: PaymentFacts | ClaimableFacts | PaymentLinkFacts,
) =>
  new PaymentReview({
    order,
    draft,
    redrafted,
    network,
    to: facts.to,
    username: Predicate.isTagged(order.to, "Username")
      ? order.to.value
      : undefined,
    asset: facts.asset,
    amount: facts.amount,
    memo: Predicate.isTagged(facts, "PaymentFacts") ? facts.memo : undefined,
    claimable: !Predicate.isTagged(facts, "PaymentFacts"),
    memoRequired: draft.memoRequired,
    expiresAt: DateTime.makeUnsafe(
      approvalDeadline(facts.maxTime, draft.request),
    ),
  });

export const reviewOf = (
  wallet: PublicDeviceWallet,
  order: TransferOrder,
  draft: TransferDraft,
  redrafted: boolean,
) =>
  Option.map(orderedFacts(wallet, order, draft), (facts) => ({
    facts,
    review: reviewFrom(order, draft, redrafted, facts),
  }));

const standingOf = (
  wallet: PublicDeviceWallet,
  shown: PaymentReview,
  nowMillis: number,
): DraftTiming => {
  const order = wallet.transfer;

  if (order === undefined || orderJson(order) !== orderJson(shown.order))
    return "stale";

  const derived = reviewOf(wallet, order, shown.draft, shown.redrafted);

  if (
    Option.isNone(derived) ||
    reviewJson(derived.value.review) !== reviewJson(shown) ||
    approvalOutstanding(wallet, Math.floor(nowMillis / 1000))
  )
    return "stale";

  return draftTiming(
    derived.value.facts.maxTime,
    shown.draft.request,
    nowMillis,
  );
};

export const standingNow = (wallet: PublicDeviceWallet, shown: PaymentReview) =>
  Effect.map(DateTime.now, (now) =>
    standingOf(wallet, shown, DateTime.toEpochMillis(now)),
  );
