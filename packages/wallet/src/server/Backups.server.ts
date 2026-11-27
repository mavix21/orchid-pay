import { Database } from "@workspace/db";
import { and, eq, lt, lte } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  type ChallengePurpose,
  CredentialId,
  PasskeyChallenge,
  Profile,
  SealedPhrase,
  Username,
} from "../contract";
import { StoreFailure } from "./Directory.server";
import { backups, passkeyChallenges, usernames } from "./tables.server";
import type { Transaction } from "./transaction.server";
import { BindingUnproven } from "./username-standing.server";

const challengeLifetimes = {
  enrollment: { minutes: 30 },
  restore: { minutes: 5 },
  session: { minutes: 5 },
} satisfies Record<ChallengePurpose, { readonly minutes: number }>;

type BackupRow = typeof backups.$inferSelect;

export interface StoredBackup {
  readonly credentialId: CredentialId;
  readonly profile: Profile;
  readonly publicKey: string;
  readonly algorithm: BackupRow["algorithm"];
  readonly counter: number;
  readonly sealed: SealedPhrase;
}

const storedBackup = (
  backup: BackupRow,
  boundUsername: string,
): StoredBackup => ({
  credentialId: Schema.decodeSync(CredentialId)(backup.credentialId),
  profile: new Profile({
    address: Schema.decodeSync(AccountAddress)(backup.address),
    username: Schema.decodeSync(Username)(boundUsername),
  }),
  publicKey: backup.publicKey,
  algorithm: backup.algorithm,
  counter: backup.counter,
  sealed: Schema.decodeSync(SealedPhrase)({
    iv: backup.iv,
    ciphertext: backup.ciphertext,
  }),
});

export type NewBackup = Omit<typeof backups.$inferInsert, "enrolledAt">;

export class Backups extends Context.Service<
  Backups,
  {
    issue(
      purpose: ChallengePurpose,
    ): Effect.Effect<PasskeyChallenge, StoreFailure>;

    consume(
      challenge: PasskeyChallenge,
      purpose: ChallengePurpose,
    ): Effect.Effect<boolean, StoreFailure>;

    commitEnrollment(
      tx: Transaction,
      challenge: PasskeyChallenge,
      backup: NewBackup,
    ): Effect.Effect<void, BindingUnproven | StoreFailure>;

    byCredential(
      credentialId: CredentialId,
    ): Effect.Effect<Option.Option<StoredBackup>, StoreFailure>;

    advance(
      credentialId: CredentialId,
      counter: number,
    ): Effect.Effect<void, StoreFailure>;
  }
>()("@workspace/wallet/server/Backups") {
  static readonly layer = Layer.effect(
    Backups,
    Effect.gen(function* () {
      const db = yield* Database;

      const issue = Effect.fn("Backups.issue")(function* (
        purpose: ChallengePurpose,
      ) {
        const challenge = Schema.decodeSync(PasskeyChallenge)(
          Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(
            crypto.getRandomValues(new Uint8Array(32)),
          ),
        );

        const cleanupAt = yield* DateTime.now;

        yield* db
          .delete(passkeyChallenges)
          .where(
            lte(passkeyChallenges.expiresAt, DateTime.toDateUtc(cleanupAt)),
          );

        const issuedAt = yield* DateTime.now;

        yield* db.insert(passkeyChallenges).values({
          challenge,
          purpose,
          expiresAt: DateTime.toDateUtc(
            DateTime.add(issuedAt, challengeLifetimes[purpose]),
          ),
        });

        return challenge;
      });

      const consume = Effect.fn("Backups.consume")(function* (
        challenge: PasskeyChallenge,
        purpose: ChallengePurpose,
      ) {
        const removed = yield* db
          .delete(passkeyChallenges)
          .where(
            and(
              eq(passkeyChallenges.challenge, challenge),
              eq(passkeyChallenges.purpose, purpose),
            ),
          )
          .returning();

        const now = yield* Clock.currentTimeMillis;

        return removed.some((row) => row.expiresAt.getTime() > now);
      });

      const commitEnrollment = Effect.fn("Backups.commitEnrollment")(function* (
        tx: Transaction,
        challenge: PasskeyChallenge,
        backup: NewBackup,
      ) {
        const removed = yield* tx
          .delete(passkeyChallenges)
          .where(
            and(
              eq(passkeyChallenges.challenge, challenge),
              eq(passkeyChallenges.purpose, "enrollment"),
            ),
          )
          .returning()
          .pipe(Effect.mapError((cause) => new StoreFailure({ cause })));

        const now = yield* Clock.currentTimeMillis;

        if (!removed.some((row) => row.expiresAt.getTime() > now))
          return yield* new BindingUnproven();

        const inserted = yield* tx
          .insert(backups)
          .values(backup)
          .onConflictDoNothing()
          .returning()
          .pipe(Effect.mapError((cause) => new StoreFailure({ cause })));

        if (inserted.length === 0) return yield* new BindingUnproven();
      });

      const byCredential = Effect.fn("Backups.byCredential")(function* (
        credentialId: CredentialId,
      ) {
        const found = yield* db
          .select({ backup: backups, boundUsername: usernames.username })
          .from(backups)
          .innerJoin(usernames, eq(usernames.address, backups.address))
          .where(eq(backups.credentialId, credentialId));

        return Option.fromNullishOr(found[0]).pipe(
          Option.map((row) => storedBackup(row.backup, row.boundUsername)),
        );
      });

      const advance = (credentialId: CredentialId, counter: number) =>
        db
          .update(backups)
          .set({ counter })
          .where(
            and(
              eq(backups.credentialId, credentialId),
              lt(backups.counter, counter),
            ),
          )
          .pipe(Effect.asVoid);

      const wrap = <A, E>(program: Effect.Effect<A, E>) =>
        program.pipe(Effect.mapError((cause) => new StoreFailure({ cause })));

      return Backups.of({
        issue: (purpose) => wrap(issue(purpose)),
        consume: (challenge, purpose) => wrap(consume(challenge, purpose)),
        commitEnrollment,
        byCredential: (credentialId) => wrap(byCredential(credentialId)),
        advance: (credentialId, counter) =>
          wrap(advance(credentialId, counter)),
      });
    }),
  );
}
