import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type {
  AccountAddress,
  Asset,
  PositiveAmount,
  SigningRequest,
  UnclaimedFundsId,
} from "../contract";
import type { AssetPlan } from "./asset-plan.server";
import type { ChainUnreachable } from "./chain-errors.server";
import type { Holdings, Issuer } from "./holdings.server";
import type { UnclaimedFundsEntry } from "./unclaimed-funds.server";

export interface AssetChain {
  validAsset(asset: Asset): boolean;
  issuedBy(asset: Asset, account: AccountAddress): boolean;
  holdings(
    address: AccountAddress,
    assets: ReadonlyArray<Asset>,
  ): Effect.Effect<Option.Option<Holdings>, ChainUnreachable>;
  issuer(asset: Asset): Effect.Effect<Option.Option<Issuer>, ChainUnreachable>;

  unclaimedFunds(
    ids: ReadonlyArray<UnclaimedFundsId>,
  ): Effect.Effect<ReadonlyArray<UnclaimedFundsEntry>, ChainUnreachable>;
  draftClaimable(
    from: AccountAddress,
    to: AccountAddress,
    asset: Asset,
    amount: PositiveAmount,
  ): Effect.Effect<SigningRequest, ChainUnreachable>;
  draftPaymentLink(
    from: AccountAddress,
    to: AccountAddress,
    asset: Asset,
    amount: PositiveAmount,
  ): Effect.Effect<SigningRequest, ChainUnreachable>;
  draftAsset(
    address: AccountAddress,
    plan: AssetPlan,
  ): Effect.Effect<SigningRequest, ChainUnreachable>;
}
