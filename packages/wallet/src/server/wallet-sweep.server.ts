import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type { UnclaimedFundsId } from "../contract";
import {
  type AssetAuthorized,
  type AssetConcluded,
  AssetOrders,
} from "./AssetOrders.server";
import { Chain, type ChainUnreachable } from "./Chain.server";
import { Directory, type StoreFailure } from "./Directory.server";
import type { SealedOpening } from "./opening-attempt.server";
import { sweepTimeBudget } from "../policy";
import { rpcReadConcurrency } from "./settings.server";
import { type Authorized, Transfers } from "./Transfers.server";

export const sweepFlow = (actions: {
  readonly reconcileTransfer: (
    entry: Authorized,
  ) => Effect.Effect<boolean, StoreFailure | ChainUnreachable>;
  readonly reconcileOpening: (
    opening: SealedOpening,
  ) => Effect.Effect<boolean, StoreFailure | ChainUnreachable>;
  readonly reconcileAsset: (
    entry: AssetAuthorized,
  ) => Effect.Effect<boolean, StoreFailure | ChainUnreachable>;
  readonly closeGoneUnclaimedFunds: (
    id: UnclaimedFundsId,
  ) => Effect.Effect<void, StoreFailure | ChainUnreachable>;
  readonly cleanUpReceivedLink: (
    concluded: AssetConcluded,
  ) => Effect.Effect<boolean, StoreFailure | ChainUnreachable>;
}) =>
  Effect.gen(function* () {
    const chain = yield* Chain;
    const directory = yield* Directory;
    const transfers = yield* Transfers;
    const assets = yield* AssetOrders;

    const goneUnclaimedFunds = Effect.gen(function* () {
      const ids = yield* transfers.unclaimedFundsToCheck;
      const entries = yield* chain.unclaimedFunds(ids);

      return ids.filter(
        (id) => !entries.some((entry) => entry.unclaimedFunds === id),
      );
    });

    const settleStuckRecords = (runStartedAt: DateTime.Utc) =>
      Effect.gen(function* () {
        const inFlight = yield* transfers.inFlight(runStartedAt);
        const assetOrders = yield* assets.inFlight(runStartedAt);
        const receivedLinks = yield* assets.receivedLinksToClean(runStartedAt);
        const openings = yield* directory.stuckOpenings(runStartedAt);

        const records = yield* Effect.forEach(
          [
            ...assetOrders.map((entry) =>
              actions.reconcileAsset(entry).pipe(Effect.asVoid),
            ),
            ...inFlight.map((entry) =>
              actions.reconcileTransfer(entry).pipe(Effect.asVoid),
            ),
            ...openings.map((opening) =>
              actions.reconcileOpening(opening).pipe(Effect.asVoid),
            ),
            ...receivedLinks.map((entry) =>
              actions.cleanUpReceivedLink(entry).pipe(Effect.asVoid),
            ),
          ],
          (program) => program.pipe(Effect.exit),
          { concurrency: rpcReadConcurrency },
        );

        return {
          picked: records.length,
          failed: records.flatMap((exit) =>
            Exit.isFailure(exit) ? [exit.cause] : [],
          ),
        };
      });

    const drainStuckRecords = Effect.fn("Wallet.drainStuckRecords")(function* (
      runStartedAt: DateTime.Utc,
    ) {
      const budgetEndsAt = DateTime.add(runStartedAt, {
        seconds: sweepTimeBudget,
      });

      const failed: Array<Cause.Cause<StoreFailure | ChainUnreachable>> = [];

      while (true) {
        const round = yield* settleStuckRecords(runStartedAt);

        failed.push(...round.failed);

        if (round.picked === 0) break;

        if (DateTime.isGreaterThan(yield* DateTime.now, budgetEndsAt)) {
          yield* Effect.logWarning("Sweep stopped at its time budget");

          break;
        }
      }

      return failed;
    });

    return Effect.gen(function* () {
      const runStartedAt = yield* DateTime.now;

      const pruned = yield* Effect.forEach(
        [
          transfers.pruneExpiredDrafts,
          assets.pruneExpiredDrafts,
          directory.pruneAbandonedOpenings,
        ],
        (prune) => prune.pipe(Effect.exit),
      );

      const unclaimedFundsExits = yield* goneUnclaimedFunds.pipe(
        Effect.flatMap((ids) =>
          Effect.forEach(
            ids,
            (id) => actions.closeGoneUnclaimedFunds(id).pipe(Effect.exit),
            { concurrency: rpcReadConcurrency },
          ),
        ),
        Effect.exit,
      );

      const drained = yield* drainStuckRecords(runStartedAt).pipe(Effect.exit);

      const failed = [
        ...pruned.flatMap((exit) => (Exit.isFailure(exit) ? [exit.cause] : [])),
        ...(Exit.isFailure(unclaimedFundsExits)
          ? [unclaimedFundsExits.cause]
          : unclaimedFundsExits.value.flatMap((exit) =>
              Exit.isFailure(exit) ? [exit.cause] : [],
            )),
        ...(Exit.isFailure(drained) ? [drained.cause] : drained.value),
      ];

      yield* Effect.forEach(failed, (cause) =>
        Effect.logError("Sweep record failed", Cause.pretty(cause)),
      );

      if (failed.length > 0)
        return yield* Effect.die(
          new Error(`${failed.length} sweep records could not be reconciled`),
        );
    });
  });
