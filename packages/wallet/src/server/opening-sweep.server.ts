import { Database } from "@workspace/db";
import { and, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import * as Array from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { sweepBatchSize } from "../policy";
import { network } from "../record-network";
import { sealedOpening } from "./opening-attempt.server";
import { notCheckedSince, stuckSince } from "./sweep-selection.server";
import { wallets } from "./tables.server";

export const stuckOpenings = Effect.fn("Directory.stuckOpenings")(function* (
  runStartedAt: DateTime.Utc,
) {
  const db = yield* Database;
  const now = yield* DateTime.now;

  const stuck = and(
    eq(wallets.network, network),
    inArray(wallets.status, ["opening", "recovered"]),
    isNotNull(wallets.attemptHash),
    lte(wallets.attemptExpiresAt, stuckSince(now)),
    notCheckedSince(wallets.sweepCheckedAt, runStartedAt),
  );

  const rows = yield* db
    .update(wallets)
    .set({ sweepCheckedAt: DateTime.toDateUtc(now) })
    .where(
      and(
        stuck,
        inArray(
          wallets.address,
          db
            .select({ address: wallets.address })
            .from(wallets)
            .where(stuck)
            .orderBy(
              sql`${wallets.sweepCheckedAt} asc nulls first`,
              wallets.address,
            )
            .limit(sweepBatchSize),
        ),
      ),
    )
    .returning();

  return Array.getSomes(rows.map(sealedOpening));
});
