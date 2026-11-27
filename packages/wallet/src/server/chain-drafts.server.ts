import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type {
  AccountAddress,
  SigningRequest,
  UnclaimedFundsId,
} from "../contract";
import type { AssetPlan } from "./asset-plan.server";
import type { ChainUnreachable } from "./chain-errors.server";
import type { PreparedLinkReceive } from "./chain-links.server";

export type DraftPurpose = Data.TaggedEnum<{
  Transfer: { readonly from: AccountAddress };
  AssetChange: {
    readonly address: AccountAddress;
    readonly plan: AssetPlan;
  };
  LinkReceive: { readonly receive: PreparedLinkReceive };
}>;

export const DraftPurpose = Data.taggedEnum<DraftPurpose>();

export interface DraftChain {
  draftCurrent(
    request: SigningRequest,
    purpose: DraftPurpose,
  ): Effect.Effect<boolean, ChainUnreachable>;
  unclaimedFundsCreatedBy(
    request: SigningRequest,
  ): Option.Option<UnclaimedFundsId>;
}
