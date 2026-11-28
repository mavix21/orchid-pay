import * as Schema from "effect/Schema";
import { UnclaimedFundsId } from "../contract";

export const ClaimPlan = Schema.TaggedStruct("ClaimPlan", {
  unclaimedFunds: UnclaimedFundsId,
});

export type AssetPlan = typeof ClaimPlan.Type;
