import { expect } from "@effect/vitest";
import { Database } from "@workspace/db";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { BackupFound, type WalletPort } from "../src/contract";
import {
  type PendingEnrollmentRecord,
  type PendingEnrollmentStorage,
  PendingActivation,
  PendingCandidate,
} from "../src/device/enrollment";
import { LocalPhraseEnvelope } from "../src/device/local-envelope";
import { backupSalt, openPhrase } from "../src/device/phrase-seal";
import { backups, usernames, wallets } from "../src/server/tables.server";
import { SoftwareAuthenticator } from "./software-authenticator";

const withTamperedEnvelope = (record: PendingEnrollmentRecord) => {
  const ciphertext = Uint8Array.from(record.candidate.envelope.ciphertext);

  ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;

  return new PendingActivation({
    enrollment: record.enrollment,
    review: record.review,
    candidate: new PendingCandidate({
      ...record.candidate,
      envelope: new LocalPhraseEnvelope({
        ...record.candidate.envelope,
        ciphertext,
      }),
    }),
  });
};

export const memoryPendingStorage = (): PendingEnrollmentStorage & {
  tamperEnvelope: boolean;
  readSync(): Option.Option<PendingEnrollmentRecord>;
} => {
  let saved = Option.none<PendingEnrollmentRecord>();

  const storage = {
    tamperEnvelope: false,
    read: () =>
      Effect.sync(() =>
        storage.tamperEnvelope
          ? Option.map(saved, withTamperedEnvelope)
          : saved,
      ),
    write: (record: PendingEnrollmentRecord) =>
      Effect.sync(() => {
        saved = Option.some(record);
      }),
    clear: () =>
      Effect.sync(() => {
        saved = Option.none();
      }),
    readSync: () => saved,
  };

  return storage;
};

export const tableRows = Effect.gen(function* () {
  const db = yield* Database;

  return {
    backups: yield* db.select().from(backups),
    usernames: yield* db.select().from(usernames),
    wallets: yield* db.select().from(wallets),
  };
});

export const restoreBackupPhrase = (
  port: WalletPort,
  auth: SoftwareAuthenticator,
) =>
  Effect.gen(function* () {
    const challenge = yield* port.restoreChallenge();

    const authenticated = Option.getOrThrow(
      yield* auth.passkeys.authenticate(challenge, yield* backupSalt),
    );

    const restored = yield* port.restore(authenticated.assertion);

    expect(restored).toBeInstanceOf(BackupFound);

    if (!(restored instanceof BackupFound))
      throw new Error("Expected BackupFound");

    return {
      profile: restored.profile,
      phrase: Option.getOrThrow(
        yield* openPhrase(authenticated.prf, restored.sealed),
      ),
    };
  });
