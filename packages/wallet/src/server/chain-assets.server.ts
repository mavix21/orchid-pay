import type { Account } from "@stellar/stellar-sdk";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import {
  type AccountAddress,
  type Asset,
  type UnclaimedFundsId,
  type PositiveAmount,
  SigningRequest,
  needsTrustline,
} from "../contract";
import { draftClaimable, draftPaymentLink } from "../stellar/asset-envelopes";
import { draftPlan } from "../stellar/asset-plans";
import type { AssetPlan } from "./asset-plan.server";
import type { Holdings, Issuer } from "./holdings.server";
import type { UnclaimedFundsEntry } from "./unclaimed-funds.server";
import {
  isIssuedBy,
  issuerAccountKey,
  toStellarAsset,
  validAsset,
} from "../stellar/assets";
import { usdc } from "../stellar/network";
import { paymentLifetime } from "../policy";
import { ChainUnreachable } from "./chain-errors.server";
import {
  accountKey,
  unclaimedFundsKey,
  unclaimedFundsFromEntries,
  holdingsFromEntries,
  issuerFromEntries,
  lineKey,
} from "../stellar/ledger-assets.server";
import type { LedgerResult, StellarRpc } from "../stellar/ledger.server";

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

export const assetChain = (
  rpc: StellarRpc,
  reserveSponsor: AccountAddress,
  source: (address: AccountAddress) => Effect.Effect<Account, ChainUnreachable>,
): AssetChain => {
  const read = <A>(
    keys: Parameters<StellarRpc["entries"]>[0],
    decode: (result: LedgerResult) => A,
  ) => rpc.entries(keys).pipe(Effect.map(decode));

  const window = Effect.map(Clock.currentTimeMillis, (now) => {
    const minTime = Math.floor(now / 1000);
    const maxTime = minTime + paymentLifetime;

    return {
      minTime,
      maxTime,
      expiresAt: DateTime.makeUnsafe(maxTime * 1000),
    };
  });

  return {
    validAsset,
    issuedBy: isIssuedBy,
    holdings: (address, assets) => {
      const trusted = assets.filter(needsTrustline);

      return read(
        [
          accountKey(address),
          lineKey(address, usdc),
          ...trusted.map((asset) => lineKey(address, toStellarAsset(asset))),
        ],
        (result) =>
          holdingsFromEntries(
            result.entries ?? [],
            reserveSponsor,
            address,
            trusted,
          ),
      );
    },
    issuer: (asset) =>
      read([issuerAccountKey(asset)], (result) =>
        issuerFromEntries(result.entries ?? [], asset),
      ),
    unclaimedFunds: (ids) =>
      ids.length === 0
        ? Effect.succeed([])
        : read(ids.map(unclaimedFundsKey), (result) =>
            unclaimedFundsFromEntries(result.entries ?? [], reserveSponsor),
          ),
    draftClaimable: Effect.fn("Chain.draftClaimable")(function* (
      from: AccountAddress,
      to: AccountAddress,
      asset: Asset,
      amount: PositiveAmount,
    ) {
      const holder = yield* source(from);
      const { expiresAt, ...bounds } = yield* window;

      return new SigningRequest({
        envelope: draftClaimable({
          ...bounds,
          source: holder,
          reserveSponsor,
          to,
          asset,
          amount,
        }),
        expiresAt,
      });
    }),
    draftPaymentLink: Effect.fn("Chain.draftPaymentLink")(function* (
      from: AccountAddress,
      to: AccountAddress,
      asset: Asset,
      amount: PositiveAmount,
    ) {
      const holder = yield* source(from);
      const { expiresAt, ...bounds } = yield* window;

      return new SigningRequest({
        envelope: draftPaymentLink({
          ...bounds,
          source: holder,
          reserveSponsor,
          to,
          asset,
          amount,
        }),
        expiresAt,
      });
    }),
    draftAsset: Effect.fn("Chain.draftAsset")(function* (
      address: AccountAddress,
      plan: AssetPlan,
    ) {
      const holder = yield* source(address);
      const { expiresAt, ...bounds } = yield* window;

      return new SigningRequest({
        envelope: draftPlan(plan, {
          ...bounds,
          source: holder,
          reserveSponsor,
        }),
        expiresAt,
      });
    }),
  };
};
