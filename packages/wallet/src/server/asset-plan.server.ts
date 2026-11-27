import * as Schema from "effect/Schema";
import {
  Asset,
  type CloseTrustline,
  type OpenTrustline,
  UnclaimedFundsId,
} from "../contract";

export const ClaimPlan = Schema.TaggedStruct("ClaimPlan", {
  unclaimedFunds: UnclaimedFundsId,
  opens: Schema.optional(Asset),
});

export type AssetPlan =
  | typeof OpenTrustline.Type
  | typeof CloseTrustline.Type
  | typeof ClaimPlan.Type;
