import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";

export type Transaction = Parameters<
  Parameters<EffectPgDatabase["transaction"]>[0]
>[0];
