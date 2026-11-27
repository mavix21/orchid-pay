import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  type AccountAddress,
  type Asset,
  type DestinationAddress,
  type PositiveAmount,
  type RecipientCannotReceive,
  needsTrustline,
  sameAsset,
} from "../contract";
import { isMuxedAddress } from "../stellar/address-rules";
import { baseAccountOf, muxedPrefixesOf } from "../stellar/destination";
import type { ChainUnreachable } from "./chain-errors.server";
import type { KnownExchangeMemo } from "../stellar/exchange-memos.server";
import type { Holdings } from "./holdings.server";

export type MemoRule = Data.TaggedEnum<{
  MemoForbidden: {};
  MemoOptional: {};
  MemoRequired: {
    readonly account: AccountAddress;
    readonly exchange: string;
    readonly source: string;
  };
}>;

export const MemoRule = Data.taggedEnum<MemoRule>();

export type ReceiveBlocker = RecipientCannotReceive["reason"];

export interface DestinationChain {
  receivingAccount(destination: DestinationAddress): AccountAddress;
  destinationPrefixesPayingInto(account: AccountAddress): ReadonlyArray<string>;
  memoRule(
    destination: DestinationAddress,
  ): Effect.Effect<MemoRule, ChainUnreachable>;
  receiveBlocker(
    account: AccountAddress,
    asset: Asset,
    amount: PositiveAmount,
  ): Effect.Effect<Option.Option<ReceiveBlocker>, ChainUnreachable>;
}

const blockerFor = (
  holdings: Option.Option<Holdings>,
  asset: Asset,
  amount: PositiveAmount,
): Option.Option<ReceiveBlocker> => {
  if (Option.isNone(holdings)) return Option.some("no_account");

  if (!needsTrustline(asset)) return Option.none();

  const line = holdings.value.lines.find((candidate) =>
    sameAsset(candidate.asset, asset),
  );

  if (line === undefined) return Option.some("no_trustline");

  if (!line.authorized) return Option.some("not_authorized");

  return line.capacity < amount ? Option.some("no_capacity") : Option.none();
};

export const destinationChain = (
  holdings: (
    address: AccountAddress,
    assets: ReadonlyArray<Asset>,
  ) => Effect.Effect<Option.Option<Holdings>, ChainUnreachable>,
  memoRequirement: (
    address: AccountAddress,
  ) => Effect.Effect<Option.Option<KnownExchangeMemo>, ChainUnreachable>,
): DestinationChain => ({
  receivingAccount: baseAccountOf,
  destinationPrefixesPayingInto: muxedPrefixesOf,
  memoRule: (destination) => {
    if (isMuxedAddress(destination))
      return Effect.succeed(MemoRule.MemoForbidden());

    const account = baseAccountOf(destination);

    return memoRequirement(account).pipe(
      Effect.map(
        Option.match({
          onNone: () => MemoRule.MemoOptional(),
          onSome: ({ exchange, source }) =>
            MemoRule.MemoRequired({ account, exchange, source }),
        }),
      ),
    );
  },
  receiveBlocker: (account, asset, amount) =>
    holdings(account, [asset]).pipe(
      Effect.map((found) => blockerFor(found, asset, amount)),
    ),
});
