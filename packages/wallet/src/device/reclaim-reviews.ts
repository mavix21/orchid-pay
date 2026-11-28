import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { AssetDraft, AssetOrder } from "../contract";
import type { PublicDeviceWallet } from "./key-store";
import { network, readDraft } from "../device-network";
import { type PaymentLinkTarget, ReclaimReview } from "./outcomes";

export const reviewJson = Schema.encodeSync(
  Schema.fromJsonString(ReclaimReview),
);

export const reviewFromJson = Schema.decodeSync(
  Schema.fromJsonString(ReclaimReview),
);

export const reviewOf = (
  wallet: PublicDeviceWallet,
  order: AssetOrder,
  draft: AssetDraft,
  redrafted: boolean,
  { asset, amount }: PaymentLinkTarget,
) => {
  const facts = readDraft(draft.request);

  if (
    Option.isNone(facts) ||
    !Predicate.isTagged(facts.value, "ClaimFacts") ||
    !Predicate.isTagged(order.action, "ClaimUnclaimedFunds")
  )
    return Option.none();

  const claim = facts.value;

  if (
    order.wallet !== wallet.address ||
    claim.address !== wallet.address ||
    claim.unclaimedFunds !== order.action.unclaimedFunds
  )
    return Option.none();

  return Option.some({
    maxTime: claim.maxTime,
    review: new ReclaimReview({
      order,
      draft,
      redrafted,
      network,
      unclaimedFunds: claim.unclaimedFunds,
      asset,
      amount,
    }),
  });
};
