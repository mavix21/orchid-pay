import { beforeAll, beforeEach } from "@effect/vitest";
import { Database, databaseLayer } from "@workspace/db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import * as Effect from "effect/Effect";

export const dbLayer = databaseLayer({
  connectionString:
    "postgres://orchid:orchid-local@127.0.0.1:55433/wallet_test",
});

export function useMigratedDatabase() {
  beforeAll(async () => {
    await Effect.runPromise(
      Database.use((db) =>
        migrate(db, { migrationsFolder: `${import.meta.dirname}/../drizzle` }),
      ).pipe(Effect.provide(dbLayer)),
    );
  });

  beforeEach(async () => {
    await Effect.runPromise(
      Database.use((db) =>
        db.execute(
          sql`truncate asset_orders, trustlines, transfers, usernames, wallets, backups, passkey_challenges, deposits, deposit_cursors, channel_leases, payment_requests`,
        ),
      ).pipe(Effect.provide(dbLayer)),
    );
  });
}
