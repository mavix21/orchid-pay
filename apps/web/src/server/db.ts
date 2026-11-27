import { env } from "cloudflare:workers";
import { databaseLayer } from "@workspace/db";
import * as Layer from "effect/Layer";

export { Database } from "@workspace/db";

export const requestDatabaseLayer = Layer.suspend(() =>
  databaseLayer(env.HYPERDRIVE),
);
