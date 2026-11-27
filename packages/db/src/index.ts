import { PgClient } from "@effect/sql-pg";
import {
  type EffectPgDatabase,
  makeWithDefaults,
} from "drizzle-orm/effect-postgres";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

export class Database extends Context.Service<Database, EffectPgDatabase>()(
  "@workspace/db/Database",
) {
  static readonly layer = Layer.effect(Database, makeWithDefaults());
}

export function databaseLayer(hyperdrive: {
  readonly connectionString: string;
}) {
  return Database.layer.pipe(
    Layer.provide(
      PgClient.layer({
        url: Redacted.make(hyperdrive.connectionString),
        connectTimeout: Duration.seconds(30),
      }),
    ),
  );
}
