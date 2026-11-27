import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import {
  type AccountAddress,
  type UnclaimedFundsId,
  Balance,
  UnclaimedFunds,
  baseAsset,
  nativeAsset,
  sameAsset,
} from "../contract";
import { AssetOrders } from "./AssetOrders.server";
import { Chain } from "./Chain.server";
import { rpcReadConcurrency } from "./settings.server";
import { Transfers } from "./Transfers.server";

export const portfolioFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const assets = yield* AssetOrders;
  const transfers = yield* Transfers;

  const loadHoldings = (
    address: AccountAddress,
    permits: Semaphore.Semaphore,
  ) =>
    Effect.gen(function* () {
      const tracked = yield* assets.tracked(address);

      const state = yield* permits.withPermit(
        chain.holdings(address, [baseAsset, ...tracked]),
      );

      const balances: Balance[] = [];

      if (Option.isSome(state)) {
        for (const line of state.value.lines)
          balances.push(
            new Balance({ asset: line.asset, amount: line.balance }),
          );

        if (state.value.nativeTotal > 0n)
          balances.push(
            new Balance({
              asset: nativeAsset,
              amount: state.value.nativeTotal,
            }),
          );

        const missing = tracked.filter(
          (asset) =>
            !state.value.lines.some((line) => sameAsset(line.asset, asset)),
        );

        yield* Effect.forEach(
          missing,
          (asset) =>
            permits
              .withPermit(chain.holdings(address, [asset]))
              .pipe(
                Effect.flatMap((confirmed) =>
                  Option.isSome(confirmed) && confirmed.value.lines.length === 0
                    ? assets.forget(address, asset)
                    : Effect.void,
                ),
              ),
          { concurrency: rpcReadConcurrency, discard: true },
        );
      }

      return {
        reserveSponsor: Option.flatMap(
          state,
          (holdings) => holdings.reserveSponsor,
        ),
        balances,
      };
    });

  const loadUnclaimedFunds = (
    address: AccountAddress,
    permits: Semaphore.Semaphore,
  ) =>
    Effect.gen(function* () {
      const pending = yield* transfers.openUnclaimedFunds(address);

      const entries = yield* permits.withPermit(
        chain.unclaimedFunds(pending.map((item) => item.id)),
      );

      const waiting: UnclaimedFunds[] = [];
      const missing: UnclaimedFundsId[] = [];

      for (const item of pending) {
        const entry = entries.find(
          (candidate) => candidate.unclaimedFunds === item.id,
        );

        if (!entry) {
          missing.push(item.id);
          continue;
        }

        waiting.push(
          new UnclaimedFunds({
            ...item,
            asset: entry.asset,
            amount: entry.amount,
            claimableAt: Option.flatMap(
              entry.claimOf(address),
              (claim) => claim.opensAt,
            ),
          }),
        );
      }

      yield* Effect.forEach(
        missing,
        (id) =>
          permits
            .withPermit(chain.unclaimedFunds([id]))
            .pipe(
              Effect.flatMap((confirmed) =>
                confirmed.length === 0
                  ? transfers.closeUnclaimedFunds(id)
                  : Effect.void,
              ),
            ),
        { concurrency: rpcReadConcurrency, discard: true },
      );

      return waiting;
    });

  const portfolio = Effect.fn("Wallet.portfolio")(function* (
    address: AccountAddress,
  ) {
    const permits = yield* Semaphore.make(rpcReadConcurrency);

    const [holdings, unclaimedFunds] = yield* Effect.all(
      [loadHoldings(address, permits), loadUnclaimedFunds(address, permits)],
      { concurrency: rpcReadConcurrency },
    );

    return {
      ...holdings,
      unclaimedFunds,
    };
  });

  return { portfolio };
});
