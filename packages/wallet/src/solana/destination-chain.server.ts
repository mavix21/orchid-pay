import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  type Asset,
  type PositiveAmount,
  sameAsset,
} from "../contract";
import type { AssetChain } from "../server/chain-assets.server";
import {
  type DestinationChain,
  MemoRule,
  type ReceiveBlocker,
} from "../server/chain-destinations.server";
import type { Holdings } from "../server/holdings.server";

const blockerFor = (
  holdings: Option.Option<Holdings>,
  asset: Asset,
  amount: PositiveAmount,
): Option.Option<ReceiveBlocker> => {
  if (Option.isNone(holdings)) return Option.some("no_account");

  const line = holdings.value.lines.find((candidate) =>
    sameAsset(candidate.asset, asset),
  );

  if (line === undefined) return Option.some("no_account");

  if (!line.authorized) return Option.some("not_authorized");

  return line.capacity < amount ? Option.some("no_capacity") : Option.none();
};

export const solanaDestinationChain = ({
  holdings,
}: Pick<AssetChain, "holdings">): DestinationChain => ({
  receivingAccount: (destination) =>
    Schema.decodeSync(AccountAddress)(destination),
  destinationPrefixesPayingInto: () => [],
  memoRule: () => Effect.succeed(MemoRule.MemoOptional()),
  receiveBlocker: (account, asset, amount) =>
    holdings(account, [asset]).pipe(
      Effect.map((found) => blockerFor(found, asset, amount)),
    ),
});
