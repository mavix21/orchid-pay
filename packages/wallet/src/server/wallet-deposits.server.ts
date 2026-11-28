import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { AccountAddress } from "../contract";
import { depositFreshness, depositTimeBudget } from "../policy";
import { Chain } from "./Chain.server";
import { type DepositCursor, Deposits } from "./Deposits.server";

export const depositFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const deposits = yield* Deposits;

  const scan = Effect.fn("Wallet.scanDeposits")(function* (
    wallet: AccountAddress,
    cursor: DepositCursor,
  ) {
    const startedAt = yield* DateTime.now;

    yield* chain
      .depositsInto(wallet, cursor.position)
      .pipe(Stream.runForEach((page) => deposits.record(wallet, page)));

    yield* deposits.scanned(wallet, startedAt);
  });

  const ingest = Effect.fn("Wallet.ingestDeposits")(function* () {
    const budgetEndsAt = DateTime.add(yield* DateTime.now, {
      seconds: depositTimeBudget,
    });

    const scans = yield* Effect.forEach(
      yield* deposits.walletsToScan,
      ({ wallet, cursor }) =>
        Effect.gen(function* () {
          if (DateTime.isGreaterThan(yield* DateTime.now, budgetEndsAt))
            return false;

          yield* scan(wallet, cursor).pipe(
            Effect.tapCause((cause) =>
              Effect.logWarning(
                "Deposit scan failed",
                wallet,
                Cause.pretty(cause),
              ),
            ),
          );

          return true;
        }).pipe(Effect.exit),
    );

    if (scans.some((scanned) => Exit.isSuccess(scanned) && !scanned.value))
      yield* Effect.logWarning("Deposit ingest stopped at its time budget");

    const failed = scans.find(Exit.isFailure);

    if (failed !== undefined) return yield* Effect.failCause(failed.cause);
  });

  const catchUp = Effect.fn("Wallet.catchUpDeposits")(function* (
    address: AccountAddress,
  ) {
    const cursor = yield* deposits.cursor(address);
    const now = yield* DateTime.now;

    const fresh = Option.exists(
      cursor.scannedAt,
      (scannedAt) =>
        DateTime.toEpochMillis(now) - DateTime.toEpochMillis(scannedAt) <=
        depositFreshness * 1000,
    );

    if (!fresh) yield* scan(address, cursor);
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
