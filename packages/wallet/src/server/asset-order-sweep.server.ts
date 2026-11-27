import { Database } from "@workspace/db";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import { sweepBatchSize } from "../policy";
import { StoreFailure } from "./Directory.server";
import {
  type AssetAuthorized,
  type AssetConcluded,
  type StoredAssetOrder,
} from "./asset-order-records.server";
import { scopeAt } from "./asset-order-links.server";
import { notCheckedSince, stuckSince } from "./sweep-selection.server";
import { assetOrders } from "./tables.server";

type Decode = (
  row: typeof assetOrders.$inferSelect,
) => Effect.Effect<StoredAssetOrder, StoreFailure>;

export const stuckAssetOrders = Effect.fn("AssetOrders.inFlight")(function* (
  runStartedAt: DateTime.Utc,
  signed: (
    row: typeof assetOrders.$inferSelect,
  ) => Effect.Effect<AssetAuthorized, StoreFailure>,
) {
  const db = yield* Database;
  const now = yield* DateTime.now;

  const stuck = and(
    scopeAt(DateTime.toEpochMillis(now)),
    eq(assetOrders.status, "authorized"),
    lte(assetOrders.expiresAt, stuckSince(now)),
    notCheckedSince(assetOrders.sweepCheckedAt, runStartedAt),
  );

  const rows = yield* db
    .update(assetOrders)
    .set({ sweepCheckedAt: DateTime.toDateUtc(now) })
    .where(
      and(
        stuck,
        inArray(
          assetOrders.id,
          db
            .select({ id: assetOrders.id })
            .from(assetOrders)
            .where(stuck)
            .orderBy(
              sql`${assetOrders.sweepCheckedAt} asc nulls first`,
              assetOrders.id,
            )
            .limit(sweepBatchSize),
        ),
      ),
    )
    .returning();

  return yield* Effect.forEach(rows, signed);
});

export const receivedLinksToClean = Effect.fn(
  "AssetOrders.receivedLinksToClean",
)(function* (runStartedAt: DateTime.Utc, decode: Decode) {
  const db = yield* Database;
  const now = yield* DateTime.now;

  const stuck = and(
    scopeAt(DateTime.toEpochMillis(now)),
    eq(assetOrders.status, "settled"),
    isNull(assetOrders.linkCleanedAt),
    sql`${assetOrders.order}::jsonb -> 'action' ->> '_tag' in ('ReceiveLink', 'ReceiveLinkExternal')`,
    lte(assetOrders.concludedAt, stuckSince(now)),
    notCheckedSince(assetOrders.sweepCheckedAt, runStartedAt),
  );

  const rows = yield* db
    .update(assetOrders)
    .set({ sweepCheckedAt: DateTime.toDateUtc(now) })
    .where(
      and(
        stuck,
        inArray(
          assetOrders.id,
          db
            .select({ id: assetOrders.id })
            .from(assetOrders)
            .where(stuck)
            .orderBy(
              sql`${assetOrders.sweepCheckedAt} asc nulls first`,
              assetOrders.concludedAt,
              assetOrders.id,
            )
            .limit(sweepBatchSize),
        ),
      ),
    )
    .returning();

  return yield* Effect.forEach(rows, (row) =>
    Effect.flatMap(
      decode(row),
      (stored): Effect.Effect<AssetConcluded, StoreFailure> =>
        Predicate.isTagged(stored, "AssetConcluded")
          ? Effect.succeed(stored)
          : Effect.fail(
              new StoreFailure({
                cause: new Error("Settled asset order is not concluded"),
              }),
            ),
    ),
  );
});

export const pruneExpiredAssetOrderDrafts = Effect.fn(
  "AssetOrders.pruneExpiredDrafts",
)(function* () {
  const db = yield* Database;
  const now = yield* DateTime.now;

  yield* db
    .delete(assetOrders)
    .where(
      and(
        scopeAt(DateTime.toEpochMillis(now)),
        eq(assetOrders.status, "proposed"),
        lte(assetOrders.expiresAt, stuckSince(now)),
      ),
    );
});
