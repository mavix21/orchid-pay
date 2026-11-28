import type { Account } from "@stellar/stellar-sdk";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  type AccountAddress,
  type Asset,
  type PositiveAmount,
  SigningRequest,
  isNativeAsset,
} from "../contract";
import { draftLifetime } from "../policy";
import type { AssetPlan } from "../server/asset-plan.server";
import type { AssetChain } from "../server/chain-assets.server";
import type { ChainUnreachable } from "../server/chain-errors.server";
import { draftClaimable, draftPaymentLink } from "./asset-envelopes";
import { draftPlan } from "./asset-plans";
import {
  isIssuedBy,
  issuerAccountKey,
  toStellarAsset,
  validAsset,
} from "./assets";
import {
  accountKey,
  holdingsFromEntries,
  issuerFromEntries,
  lineKey,
  unclaimedFundsFromEntries,
  unclaimedFundsKey,
} from "./ledger-assets.server";
import type { LedgerResult, StellarRpc } from "./ledger.server";
import { usdc } from "./network";

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
    const maxTime = minTime + draftLifetime;

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
      const trusted = assets.filter((asset) => !isNativeAsset(asset));

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
    unclaimedFundsClosedAt: () => Effect.succeed(Option.none()),
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
