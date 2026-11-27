import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { AccountAddress } from "../contract";
import {
  depositCatchUpLimit,
  depositCatchUpSpan,
  depositFreshness,
  depositPageLimit,
  depositTimeBudget,
} from "../policy";
import { Chain } from "./Chain.server";
import { EventsStart } from "./chain-deposits.server";
import { Deposits } from "./Deposits.server";

export const depositFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const deposits = yield* Deposits;

  const ingest = Effect.fn("Wallet.ingestDeposits")(function* () {
    const budgetEndsAt = DateTime.add(yield* DateTime.now, {
      seconds: depositTimeBudget,
    });

    const feed = chain.depositFeed;
    let start = yield* chain.resumeDeposits(deposits.cursor(feed));

    while (true) {
      const page = yield* chain.assetEvents({
        start,
        wallet: Option.none(),
        limit: depositPageLimit,
      });

      yield* deposits.store(
        page.events,
        Option.some({
          ...page.position,
          feed,
          closedAt: page.cursorClosedAt,
        }),
      );

      if (page.drained) return;

      if (DateTime.isGreaterThan(yield* DateTime.now, budgetEndsAt)) {
        yield* Effect.logWarning("Deposit ingest stopped at its time budget");

        return;
      }

      start = EventsStart.FromCursor({ cursor: page.position.cursor });
    }
  });

  const catchUp = Effect.fn("Wallet.catchUpDeposits")(function* (
    address: AccountAddress,
  ) {
    const stored = yield* deposits.cursor(chain.depositFeed);
    const now = yield* DateTime.now;

    const sinceCursor = Option.flatMap(stored, ({ closedAt }) => closedAt).pipe(
      Option.map(
        (closedAt) =>
          DateTime.toEpochMillis(now) - DateTime.toEpochMillis(closedAt),
      ),
    );

    if (Option.exists(sinceCursor, (age) => age <= depositFreshness * 1000))
      return;

    const recent = Option.filter(stored, () =>
      Option.exists(sinceCursor, (age) => age <= depositCatchUpSpan * 1000),
    );

    const page = yield* chain.assetEvents({
      start: yield* chain.catchUpDeposits(recent),
      wallet: Option.some(address),
      limit: depositCatchUpLimit,
    });

    yield* deposits.store(page.events, Option.none());
  });

  return {
    ingest,
    catchUp: (address: AccountAddress) =>
      catchUp(address).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Deposit catch-up failed", Cause.pretty(cause)),
        ),
      ),
  };
});
