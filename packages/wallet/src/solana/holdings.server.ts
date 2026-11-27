import { address } from "@solana/kit";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { type AccountAddress, Amount, type Asset } from "../contract";
import type { AssetChain } from "../server/chain-assets.server";
import type { Holdings, Line } from "../server/holdings.server";
import { solanaProfile } from "./profile";
import type { SolanaRpc } from "./rpc.server";
import { UsdcAccount, readUsdcAccount } from "./usdc-account.server";

type Held = Extract<UsdcAccount, { readonly _tag: "Held" }>;

const amountOf = (units: bigint) =>
  Schema.decodeSync(Amount)((units < 0n ? 0n : units).toString());

const lineOf = (
  asset: Asset,
  { amount, frozen }: Held,
  sponsored: boolean,
): Line => ({
  asset,
  balance: amountOf(amount),
  spendable: amountOf(frozen ? 0n : amount),
  capacity: amountOf(
    frozen ? 0n : solanaProfile.precisionOf(asset.id).maximum - amount,
  ),
  authorized: !frozen,
  clawbackEnabled: false,
  sponsored,
});

const holdingsOf = (
  held: Held,
  sponsor: AccountAddress,
  assets: ReadonlyArray<Asset>,
): Holdings => {
  const sponsored = Option.contains(held.closeAuthority, address(sponsor));

  return {
    nativeTotal: amountOf(0n),
    reserveSponsor: sponsored ? Option.some(sponsor) : Option.none(),
    native: amountOf(0n),
    trustlineSlotsUsed: 0,
    lines: assets.flatMap((asset) =>
      asset.id === solanaProfile.baseAsset.id
        ? [lineOf(asset, held, sponsored)]
        : [],
    ),
  };
};

export const solanaHoldings = (
  rpc: SolanaRpc,
  sponsor: AccountAddress,
): Pick<AssetChain, "holdings"> => ({
  holdings: (wallet, assets) =>
    readUsdcAccount(rpc, address(wallet)).pipe(
      Effect.map(
        UsdcAccount.$match({
          Absent: () => Option.none<Holdings>(),
          Foreign: () => Option.none<Holdings>(),
          Held: (held) => Option.some(holdingsOf(held, sponsor, assets)),
        }),
      ),
    ),
});
