import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  type AccountAddress,
  type Asset,
  type PositiveAmount,
  isNativeAsset,
  sameAsset,
} from "../contract";
import type { ChainUnreachable } from "../server/chain-errors.server";
import {
  type DestinationChain,
  MemoRule,
  type ReceiveBlocker,
} from "../server/chain-destinations.server";
import type { Holdings } from "../server/holdings.server";
import { isMuxedAddress } from "./address-rules";
import { baseAccountOf, muxedPrefixesOf } from "./destination";
import type { KnownExchangeMemo } from "./exchange-memos.server";

const blockerFor = (
  holdings: Option.Option<Holdings>,
  asset: Asset,
  amount: PositiveAmount,
): Option.Option<ReceiveBlocker> => {
  if (Option.isNone(holdings)) return Option.some("no_account");

  if (isNativeAsset(asset)) return Option.none();

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
