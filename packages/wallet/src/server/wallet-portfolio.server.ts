import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type AccountAddress, Balance, baseAsset } from "../contract";
import { Chain } from "./Chain.server";

export const portfolioFlow = Effect.gen(function* () {
  const chain = yield* Chain;

  const portfolio = Effect.fn("Wallet.portfolio")(function* (
    address: AccountAddress,
  ) {
    const state = yield* chain.holdings(address, [baseAsset]);

    return {
      reserveSponsor: Option.flatMap(
        state,
        (holdings) => holdings.reserveSponsor,
      ),
      balances: Option.match(state, {
        onNone: () => [],
        onSome: (holdings) =>
          holdings.lines.map(
            (line) => new Balance({ asset: line.asset, amount: line.balance }),
          ),
      }),
    };
  });

  return { portfolio };
});
