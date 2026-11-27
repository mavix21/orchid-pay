import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { AccountAddress, OpeningDraft, SigningRequest } from "../contract";
import { approvalMargin, paymentLifetime } from "../policy";
import type { PublicDeviceWallet } from "./key-store";
import { readDraft } from "../device-network";
import { OpeningReview } from "./outcomes";
import { clockAllowance } from "./transfer-drafts";

export type OpeningStanding = "current" | "expiring" | "stale";

export const reviewJson = Schema.encodeSync(
  Schema.fromJsonString(OpeningReview),
);

export const reviewFromJson = Schema.decodeSync(
  Schema.fromJsonString(OpeningReview),
);

const timing = (
  maxTime: number,
  request: SigningRequest,
  nowMillis: number,
): OpeningStanding => {
  if (
    DateTime.toEpochMillis(request.expiresAt) !== maxTime * 1000 ||
    maxTime > Math.floor(nowMillis / 1000) + paymentLifetime + clockAllowance
  )
    return "stale";

  return maxTime * 1000 - nowMillis >= approvalMargin * 1000
    ? "current"
    : "expiring";
};

export const standingOf = (
  wallet: PublicDeviceWallet,
  shown: OpeningReview,
  nowMillis: number,
): OpeningStanding => {
  if (wallet.address !== shown.address || wallet.username !== shown.username)
    return "stale";

  const opening = readDraft(shown.draft.request);

  return Option.isSome(opening) &&
    Predicate.isTagged(opening.value, "OpeningFacts") &&
    opening.value.address === wallet.address &&
    opening.value.channel !== wallet.address
    ? timing(opening.value.maxTime, shown.draft.request, nowMillis)
    : "stale";
};

export const currentUntil = (shown: OpeningReview): number =>
  DateTime.toEpochMillis(shown.draft.request.expiresAt) - approvalMargin * 1000;

export const standingNow = (wallet: PublicDeviceWallet, shown: OpeningReview) =>
  Effect.map(DateTime.now, (now) =>
    standingOf(wallet, shown, DateTime.toEpochMillis(now)),
  );

export const reserveSponsorOf = (
  draft: OpeningDraft,
): Option.Option<AccountAddress> => {
  const facts = readDraft(draft.request);

  return Option.isSome(facts) && Predicate.isTagged(facts.value, "OpeningFacts")
    ? Option.some(facts.value.reserveSponsor)
    : Option.none();
};
