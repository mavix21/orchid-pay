import { Database, databaseLayer } from "@workspace/db";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

await Effect.runPromise(
  Effect.gen(function* () {
    const url = yield* Config.String("DATABASE_URL_UNPOOLED");

    yield* Effect.gen(function* () {
      const db = yield* Database;

      yield* migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` });
    }).pipe(Effect.provide(databaseLayer({ connectionString: url })));
  }),
);

console.log("Wallet migrations applied.");
