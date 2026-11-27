import type { Address } from "@solana/kit";
import { and, count, eq, gt } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { sponsoredFailures } from "../server/tables.server";

export const sponsoredFailureLimit = {
  failures: 3,
  window: Duration.hours(24),
};

export interface SponsoredFailures {
  recordLanded(signer: Address, signature: string): Effect.Effect<void>;
  admits(signer: Address): Effect.Effect<boolean>;
}

export const sponsoredFailuresIn = (
  db: EffectPgDatabase,
): SponsoredFailures => ({
  recordLanded: (signer, signature) =>
    Effect.gen(function* () {
      const landedAt = new Date(DateTime.toEpochMillis(yield* DateTime.now));

      yield* db
        .insert(sponsoredFailures)
        .values({ signature, signer, landedAt })
        .onConflictDoNothing();
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Sponsored failure not recorded", cause),
      ),
    ),
  admits: (signer) =>
    Effect.gen(function* () {
      const since = DateTime.subtractDuration(
        yield* DateTime.now,
        sponsoredFailureLimit.window,
      );

      const [landed] = yield* db
        .select({ failures: count() })
        .from(sponsoredFailures)
        .where(
          and(
            eq(sponsoredFailures.signer, signer),
            gt(
              sponsoredFailures.landedAt,
              new Date(DateTime.toEpochMillis(since)),
            ),
          ),
        );

      return (landed?.failures ?? 0) < sponsoredFailureLimit.failures;
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Sponsored failure limit unavailable", cause).pipe(
          Effect.as(true),
        ),
      ),
    ),
});
