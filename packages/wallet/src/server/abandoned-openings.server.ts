import { Database } from "@workspace/db";
import { and, eq, exists, isNull, lte, not } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { epochAt, network } from "../record-network";
import { stuckSince } from "./sweep-selection.server";
import {
  assetOrders,
  backups,
  deposits,
  transfers,
  usernames,
  wallets,
} from "./tables.server";

export const pruneAbandonedOpenings = Effect.fn(
  "Directory.pruneAbandonedOpenings",
)(function* () {
  const db = yield* Database;
  const now = yield* DateTime.now;

  const referencing = [
    db
      .select({ address: usernames.address })
      .from(usernames)
      .where(eq(usernames.address, wallets.address)),
    db
      .select({ address: backups.address })
      .from(backups)
      .where(eq(backups.address, wallets.address)),
    db
      .select({ address: transfers.sender })
      .from(transfers)
      .where(eq(transfers.sender, wallets.address)),
    db
      .select({ address: assetOrders.wallet })
      .from(assetOrders)
      .where(eq(assetOrders.wallet, wallets.address)),
    db
      .select({ address: deposits.wallet })
      .from(deposits)
      .where(eq(deposits.wallet, wallets.address)),
  ];

  yield* db
    .delete(wallets)
    .where(
      and(
        eq(wallets.network, network),
        eq(wallets.testnetEpoch, epochAt(DateTime.toEpochMillis(now))),
        eq(wallets.status, "opening"),
        lte(wallets.attemptExpiresAt, stuckSince(now)),
        isNull(wallets.attemptHash),
        ...referencing.map((query) => not(exists(query))),
      ),
    );
});
