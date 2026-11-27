import { Database } from "@workspace/db";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import { sweepBatchSize } from "../policy";
import { epochAt, network } from "../record-network";
import { StoreFailure } from "./Directory.server";
import { notCheckedSince, stuckSince } from "./sweep-selection.server";
import { transfers } from "./tables.server";
import type {
  Authorized,
  Transfer,
  TransferRow,
} from "./transfer-records.server";

type Decode = (row: TransferRow) => Effect.Effect<Transfer, StoreFailure>;

export const stuckTransfers = Effect.fn("Transfers.inFlight")(function* (
  runStartedAt: DateTime.Utc,
  decode: Decode,
) {
  const db = yield* Database;
  const now = yield* DateTime.now;

  const stuck = and(
    eq(transfers.network, network),
    eq(transfers.testnetEpoch, epochAt(DateTime.toEpochMillis(now))),
    eq(transfers.status, "authorized"),
    lte(transfers.expiresAt, stuckSince(now)),
    notCheckedSince(transfers.sweepCheckedAt, runStartedAt),
  );

  const rows = yield* db
    .update(transfers)
    .set({ sweepCheckedAt: DateTime.toDateUtc(now) })
    .where(
      and(
        stuck,
        inArray(
          transfers.id,
          db
            .select({ id: transfers.id })
            .from(transfers)
            .where(stuck)
            .orderBy(
              sql`${transfers.sweepCheckedAt} asc nulls first`,
              transfers.id,
            )
            .limit(sweepBatchSize),
        ),
      ),
    )
    .returning();

  return yield* Effect.forEach(
    rows,
    (row): Effect.Effect<Authorized, StoreFailure> =>
      decode(row).pipe(
        Effect.flatMap((transfer) =>
          Predicate.isTagged(transfer, "Authorized")
            ? Effect.succeed(transfer)
            : Effect.fail(
                new StoreFailure({
                  cause: new Error("Invalid in-flight state"),
                }),
              ),
        ),
      ),
  );
});

export const pruneExpiredTransferDrafts = Effect.fn(
  "Transfers.pruneExpiredDrafts",
)(function* () {
  const db = yield* Database;
  const now = yield* DateTime.now;

  yield* db
    .delete(transfers)
    .where(
      and(
        eq(transfers.network, network),
        eq(transfers.testnetEpoch, epochAt(DateTime.toEpochMillis(now))),
        eq(transfers.status, "proposed"),
        lte(transfers.expiresAt, stuckSince(now)),
      ),
    );
});
