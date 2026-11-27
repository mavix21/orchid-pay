import "fake-indexeddb/auto";
import { expect, layer } from "@effect/vitest";
import { Database } from "@workspace/db";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  Offline,
  Username,
  UsernameTaken,
  type WalletPort,
} from "../src/contract";
import type { RelyingParty } from "../src/device/assertion";
import { browserKeyStore } from "../src/device/browser-key-store";
import {
  type EnrollmentDependencies,
  type PendingEnrollmentStorage,
  makeEnrollmentEffects,
} from "../src/device/enrollment";
import { passkeyChallenges } from "../src/server/tables.server";
import { Wallet } from "../src/server/Wallet.server";
import { clearDatabase, relyingParty } from "./sealed-wallet-fixtures";
import { settlingOpenings } from "./settling-openings";
import { SoftwareAuthenticator } from "./software-authenticator";
import { assertTagged } from "./tagged";

import { memoryPendingStorage, tableRows } from "./enrollment-fixtures";
import {
  passkeyOrigin,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./stellar-harness";

const enrollmentFor = (
  port: WalletPort,
  auth: SoftwareAuthenticator,
  pending?: PendingEnrollmentStorage,
  party: RelyingParty = relyingParty,
  exclusive?: EnrollmentDependencies["exclusive"],
) =>
  makeEnrollmentEffects({
    port,
    store: browserKeyStore,
    registration: auth.registration,
    assertions: auth.assertions,
    relyingParty: party,
    pending,
    exclusive,
  });

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect("refuses a taken name before any passkey is created", () =>
      Effect.gen(function* () {
        yield* Effect.promise(clearDatabase);

        const wallet = settlingOpenings(yield* Wallet);

        const owner = enrollmentFor(
          wallet,
          new SoftwareAuthenticator(passkeyOrigin),
        );

        const started = yield* owner.start("maria");

        assertTagged(started, "EnrollmentPending");
        assertTagged(yield* owner.advance(started.review), "WalletEnrolled");
        yield* Effect.promise(clearDatabase);

        const latecomer = new SoftwareAuthenticator(passkeyOrigin);

        world.humanCheckRefused = true;
        expect(yield* enrollmentFor(wallet, latecomer).start("maria")).toEqual(
          new UsernameTaken({
            username: Schema.decodeSync(Username)("maria"),
          }),
        );
        expect(latecomer.registered).toHaveLength(0);
      }),
    );

    it.effect(
      "returns to choosing a name with nothing stored when another device binds it first",
      () =>
        Effect.gen(function* () {
          yield* Effect.promise(clearDatabase);

          const wallet = settlingOpenings(yield* Wallet);

          const loser = enrollmentFor(
            wallet,
            new SoftwareAuthenticator(passkeyOrigin),
            memoryPendingStorage(),
          );

          const loserStarted = yield* loser.start("maria");

          assertTagged(loserStarted, "EnrollmentPending");

          const winner = enrollmentFor(
            wallet,
            new SoftwareAuthenticator(passkeyOrigin),
          );

          const winnerStarted = yield* winner.start("maria");

          assertTagged(winnerStarted, "EnrollmentPending");
          assertTagged(
            yield* winner.advance(winnerStarted.review),
            "WalletEnrolled",
          );

          const winnerRows = yield* tableRows;

          yield* Effect.promise(clearDatabase);

          expect(yield* loser.advance(loserStarted.review)).toEqual(
            new UsernameTaken({
              username: Schema.decodeSync(Username)("maria"),
            }),
          );
          expect(yield* loser.pending()).toEqual(Option.none());
          expect(yield* browserKeyStore.readSealed()).toEqual(Option.none());
          expect((yield* tableRows).backups).toEqual(winnerRows.backups);
          expect((yield* tableRows).usernames).toEqual(winnerRows.usernames);
        }),
    );

    it.effect(
      "discards an unsigned enrollment so another name can be chosen, but never a signed one",
      () =>
        Effect.gen(function* () {
          yield* Effect.promise(clearDatabase);

          const wallet = settlingOpenings(yield* Wallet);

          const offlineCommit: WalletPort = {
            ...wallet,
            enroll: () => Effect.fail(new Offline()),
          };

          const tab = enrollmentFor(
            offlineCommit,
            new SoftwareAuthenticator(passkeyOrigin),
            memoryPendingStorage(),
          );

          assertTagged(yield* tab.start("maria"), "EnrollmentPending");
          expect(yield* tab.discard()).toBe(true);
          expect(yield* tab.pending()).toEqual(Option.none());

          const renamed = yield* tab.start("pedro");

          assertTagged(renamed, "EnrollmentPending");
          expect(renamed.username).toBe("pedro");
          expect(yield* tab.advance(renamed.review)).toEqual(new Offline());
          expect(yield* tab.discard()).toBe(false);
          expect(Option.getOrThrow(yield* tab.pending()).stage).toBe("release");
        }),
    );

    const refusalCases = [
      [
        "the authenticator returns no PRF on the activation get",
        (wallet: WalletPort) =>
          Effect.gen(function* () {
            const auth = new SoftwareAuthenticator(passkeyOrigin);

            auth.prf = false;

            const enrollment = enrollmentFor(wallet, auth);

            const started = yield* enrollment.start("maria");

            assertTagged(started, "EnrollmentPending");

            return {
              outcome: yield* enrollment.advance(started.review),
              expectedTag: "BackupUnsupported",
              enrollment,
            };
          }),
      ],
      [
        "the registration comes from an unlisted origin",
        (wallet: WalletPort) =>
          Effect.gen(function* () {
            const unlisted = {
              origin: "https://example.com",
              rpId: "example.com",
            };

            const auth = new SoftwareAuthenticator(unlisted.origin);

            const enrollment = enrollmentFor(wallet, auth, undefined, unlisted);

            const started = yield* enrollment.start("maria");

            assertTagged(started, "EnrollmentPending");

            return {
              outcome: yield* enrollment.advance(started.review),
              expectedTag: "RegistrationRefused",
              enrollment,
            };
          }),
      ],
      [
        "the enrollment challenge expires before the commit",
        (wallet: WalletPort) =>
          Effect.gen(function* () {
            const auth = new SoftwareAuthenticator(passkeyOrigin);
            const enrollment = enrollmentFor(wallet, auth);
            const started = yield* enrollment.start("maria");

            assertTagged(started, "EnrollmentPending");

            const db = yield* Database;

            yield* db
              .update(passkeyChallenges)
              .set({ expiresAt: new Date(Date.now() - 1000) });

            return {
              outcome: yield* enrollment.advance(started.review),
              expectedTag: "ChallengeRefused",
              enrollment,
            };
          }),
      ],
      [
        "the persisted candidate envelope is tampered before it is read back",
        (wallet: WalletPort) =>
          Effect.gen(function* () {
            const auth = new SoftwareAuthenticator(passkeyOrigin);
            const pending = memoryPendingStorage();

            const enrollment = enrollmentFor(wallet, auth, pending);

            const started = yield* enrollment.start("maria");

            assertTagged(started, "EnrollmentPending");
            pending.tamperEnvelope = true;

            return {
              outcome: yield* enrollment.advance(started.review),
              expectedTag: "CorruptEnvelope",
              enrollment,
            };
          }),
      ],
    ] as const;

    it.effect.each(refusalCases)(
      "refuses activation without storing a local wallet, binding a username or releasing a signature when %s",
      ([, runCase]) =>
        Effect.gen(function* () {
          yield* Effect.promise(clearDatabase);

          const wallet = settlingOpenings(yield* Wallet);

          const { outcome, expectedTag, enrollment } = yield* runCase(wallet);

          expect(outcome._tag).toBe(expectedTag);
          expect(yield* enrollment.pending()).toEqual(Option.none());
          expect(yield* browserKeyStore.readPublic()).toEqual(Option.none());
          expect(yield* browserKeyStore.readSealed()).toEqual(Option.none());
          expect((yield* tableRows).usernames).toEqual([]);
          expect((yield* tableRows).backups).toEqual([]);
          expect(world.submitted).toHaveLength(0);
        }),
    );
  },
);
