import "fake-indexeddb/auto";
import { expect, layer } from "@effect/vitest";
import { Database } from "@workspace/db";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { eq } from "drizzle-orm";
import {
  NoBackup,
  PasskeyChallenge,
  type WalletPort,
  AssertionRefused,
  BackupEnrollment,
  BackupFound,
  ChallengeRefused,
  CredentialId,
  type PasskeyAssertion,
  Profile,
  SessionBegun,
  Username,
  WalletClaim,
} from "../src/contract";
import { PinnedCredential } from "../src/device/assertion";
import { browserKeyStore } from "../src/device/browser-key-store";
import {
  BackupLocated,
  BackupMismatch,
  PasskeyCancelled,
  Restored,
  type WalletEffects,
  makeWalletEffects,
} from "../src/device/client";
import {
  PublicDeviceWallet,
  SealedDeviceWallet,
} from "../src/device/key-store";
import {
  LocalPhraseEnvelope,
  freshInstallationSalt,
  localPhrasePrfInput,
  reopenLocalEnvelope,
  sealLocalEnvelope,
} from "../src/device/local-envelope";
import {
  backups,
  usernames,
  wallets,
  passkeyChallenges,
} from "../src/server/tables.server";
import { Wallet } from "../src/server/Wallet.server";
import { epochAt, network } from "../src/record-network";
import { memoryKeyStore } from "./device-fixtures";
import {
  clearDatabase,
  enrollDisposableWallet,
  relyingParty,
} from "./sealed-wallet-fixtures";
import { randomAddress } from "./test-keys";
import { signingKey } from "./device-fixtures";
import { SoftwareAuthenticator } from "./software-authenticator";
import { assertTagged } from "./tagged";
import {
  passkeyOrigin,
  useDisposableDatabase,
  walletTestLayer,
  approveOpening,
  claimFor,
  dbLayer,
  settleSubmitted,
  walletForDb,
} from "./wallet-harness";
import { backupSalt, sealPhrase } from "../src/device/phrase-seal";
import { generateSecretPhrase } from "../src/device/secret-phrase";
import { Backups } from "../src/server/Backups.server";
import { Principal } from "../src/server/Principal.server";
import * as Layer from "effect/Layer";

const restoringDevice = (port: WalletPort, auth: SoftwareAuthenticator) =>
  makeWalletEffects(port, memoryKeyStore(), auth.passkeys, {
    store: browserKeyStore,
    ceremony: auth.assertions,
    relyingParty: () => relyingParty,
  });

const restoreOnFreshTaps = (client: WalletEffects) =>
  Effect.gen(function* () {
    const located = yield* client.restore();
    const restored = yield* client.restore();

    return { located, restored };
  });

const restoredPhrase = (auth: SoftwareAuthenticator) =>
  Effect.gen(function* () {
    const stored = Option.getOrThrow(yield* browserKeyStore.readSealed());

    const reopened = yield* reopenLocalEnvelope(
      auth.assertions,
      relyingParty,
      stored.credential,
      stored.envelope,
      { network, address: stored.public.address, purpose: "approval" },
    );

    assertTagged(reopened, "PhraseOpened");

    return Redacted.value(reopened.phrase);
  });

const enrollBackedWallet = (
  port: WalletPort,
  auth: SoftwareAuthenticator,
  username: string,
) =>
  Effect.gen(function* () {
    yield* Effect.promise(clearDatabase);

    const phrase = generateSecretPhrase();
    const key = signingKey(phrase);
    const claim = claimFor(key, username);
    const issued = yield* port.enrollmentChallenge(claim);

    assertTagged(issued, "ChallengeIssued");

    const { prf, registration } = Option.getOrThrow(
      auth.enrollWithPrf(issued.challenge, yield* backupSalt),
    );

    const enrollment = new BackupEnrollment({
      address: claim.address,
      username: claim.username,
      registration,
      sealed: yield* sealPhrase(prf, phrase),
    });

    const draft = yield* port.open(claim, Option.none());

    assertTagged(draft, "OpeningDraft");
    assertTagged(
      yield* port.enroll(
        enrollment,
        Option.getOrThrow(approveOpening(key, draft)),
      ),
      "OpeningPending",
    );
    yield* settleSubmitted();
    assertTagged(yield* port.open(claim, Option.none()), "Opened");

    return { profile: new Profile(claim), phrase };
  });

const backupRows = Effect.gen(function* () {
  const db = yield* Database;

  return yield* db.select().from(backups);
});

const restoreAssertion = (
  port: WalletPort,
  auth: SoftwareAuthenticator,
  challenge?: PasskeyChallenge,
) =>
  Effect.gen(function* () {
    const token = challenge ?? (yield* port.restoreChallenge());
    const passkey = yield* auth.passkeys.authenticate(token, yield* backupSalt);

    return Option.getOrThrow(passkey).assertion;
  });

const sessionAssertion = (
  auth: SoftwareAuthenticator,
  credentialId: PasskeyAssertion["id"],
  challenge: PasskeyChallenge,
) =>
  auth.assertions
    .assert({ credentialId, challenge, prf: Option.none() })
    .pipe(Effect.map((platform) => platform.assertion));

const atRequest = <A, E>(program: Effect.Effect<A, E, Wallet | Principal>) =>
  program.pipe(Effect.provide(Layer.fresh(walletForDb(dbLayer))), Effect.orDie);

const beginningSession = (assertion: PasskeyAssertion) =>
  atRequest(
    Effect.gen(function* () {
      const step = yield* (yield* Wallet).beginSession(assertion);

      return { step, issued: yield* (yield* Principal).issued };
    }),
  );

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "restore seals the backed phrase to the same credential and refuses a mismatched device or profile address",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const auth = new SoftwareAuthenticator(passkeyOrigin);
          const enrolled = yield* enrollBackedWallet(wallet, auth, "maria");
          const phrase = enrolled.phrase;
          const backupRow = (yield* backupRows)[0];

          yield* Effect.promise(clearDatabase);

          const restoring = restoringDevice(wallet, auth);
          const steps = yield* restoreOnFreshTaps(restoring);

          expect(steps.located).toBeInstanceOf(BackupLocated);
          expect(
            steps.restored instanceof Restored && steps.restored.profile,
          ).toEqual(enrolled.profile);

          const installed = Option.getOrThrow(
            yield* browserKeyStore.readSealed(),
          );

          expect(installed.credential.id).toBe(backupRow?.credentialId);
          expect(installed.credential.publicKey).toBe(backupRow?.publicKey);
          expect(installed.public.username).toBe("maria");
          expect(installed.public.backup).toBe("stored");
          expect(yield* restoredPhrase(auth)).toBe(phrase);

          yield* browserKeyStore.writeSealed(
            new SealedDeviceWallet({
              ...installed,
              envelope: new LocalPhraseEnvelope({
                ...installed.envelope,
                ciphertext: Uint8Array.from(
                  installed.envelope.ciphertext,
                  (byte) => byte ^ 1,
                ),
              }),
            }),
          );
          expect(
            (yield* restoreOnFreshTaps(restoring)).restored,
          ).toBeInstanceOf(Restored);
          expect(yield* restoredPhrase(auth)).toBe(phrase);

          yield* Effect.promise(clearDatabase);
          const stranger = yield* enrollDisposableWallet("otro");

          yield* browserKeyStore.writeSealed(stranger.record);
          expect(yield* restoringDevice(wallet, auth).restore()).toEqual(
            new BackupMismatch(),
          );
          expect(yield* browserKeyStore.readSealed()).toEqual(
            Option.some(stranger.record),
          );

          yield* Effect.promise(clearDatabase);
          const db = yield* Database;

          yield* db.insert(wallets).values({
            address: stranger.address,
            status: "opening",
            network,
            testnetEpoch: epochAt(Date.now()),
          });
          yield* db
            .insert(usernames)
            .values({ username: "otro", address: stranger.address });
          yield* db.update(backups).set({ address: stranger.address });

          const tampered = restoringDevice(wallet, auth);

          expect(yield* tampered.restore()).toBeInstanceOf(BackupLocated);
          expect(yield* tampered.restore()).toEqual(new BackupMismatch());
          expect(yield* browserKeyStore.readSealed()).toEqual(Option.none());
        }),
    );

    it.effect(
      "restore finds no backup when the name requested at enrollment is bound to another address",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const auth = new SoftwareAuthenticator(passkeyOrigin);
          const enrolled = yield* enrollBackedWallet(wallet, auth, "maria");
          const db = yield* Database;
          const rival = randomAddress();

          yield* db
            .delete(usernames)
            .where(eq(usernames.address, enrolled.profile.address));
          yield* db.insert(wallets).values({
            address: rival,
            status: "opening",
            network,
            testnetEpoch: epochAt(Date.now()),
          });
          yield* db
            .insert(usernames)
            .values({ username: "maria", address: rival });

          expect(
            yield* wallet.restore(yield* restoreAssertion(wallet, auth)),
          ).toEqual(new NoBackup());
        }),
    );

    it.effect(
      "restore over the same address under another credential replaces the credential only on the sealing tap, which can be cancelled and retried",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const auth = new SoftwareAuthenticator(passkeyOrigin);
          const enrolled = yield* enrollBackedWallet(wallet, auth, "maria");
          const phrase = enrolled.phrase;
          const profile = (yield* backupRows)[0];
          const { address, username } = enrolled.profile;

          const oldAuth = new SoftwareAuthenticator(passkeyOrigin);
          const salt = freshInstallationSalt();

          const registered = Option.getOrThrow(
            oldAuth.enrollWithPrf(
              Schema.decodeSync(PasskeyChallenge)("A".repeat(43)),
              yield* localPhrasePrfInput({ network, address, salt }),
            ),
          );

          const oldCredential = new PinnedCredential({
            id: registered.registration.id,
            publicKey: registered.registration.publicKey,
            algorithm: "ES256",
          });

          const oldSeal = yield* sealLocalEnvelope(
            {
              phrase,
              network,
              address,
              credentialId: oldCredential.id,
              salt,
            },
            Redacted.make(Uint8Array.from(registered.prf)),
          );

          assertTagged(oldSeal, "EnvelopeSealed");
          yield* browserKeyStore.writeSealed(
            new SealedDeviceWallet({
              version: 2,
              public: new PublicDeviceWallet({ address, username }),
              credential: oldCredential,
              envelope: oldSeal.envelope,
            }),
          );

          const restoring = restoringDevice(wallet, auth);

          yield* restoring.restore();
          auth.cancels = true;
          expect(yield* restoring.restore()).toEqual(new PasskeyCancelled());
          expect(
            Option.getOrThrow(yield* browserKeyStore.readSealed()).credential
              .id,
          ).toBe(oldCredential.id);

          auth.cancels = false;
          expect(yield* restoring.restore()).toBeInstanceOf(Restored);

          const installed = Option.getOrThrow(
            yield* browserKeyStore.readSealed(),
          );

          expect(installed.credential.id).toBe(profile?.credentialId);
          expect(installed.public.backup).toBe("stored");
          expect(yield* restoredPhrase(auth)).toBe(phrase);
        }),
    );

    it.effect(
      "restore releases a backup only for a fresh restore challenge and its own credential",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const auth = new SoftwareAuthenticator(passkeyOrigin);

          yield* enrollBackedWallet(wallet, auth, "maria");
          const fresh = yield* restoreAssertion(wallet, auth);

          expect(yield* wallet.restore(fresh)).toBeInstanceOf(BackupFound);
          expect(yield* wallet.restore(fresh)).toEqual(new ChallengeRefused());

          const expiring = yield* restoreAssertion(wallet, auth);
          const db = yield* Database;

          yield* db
            .update(passkeyChallenges)
            .set({ expiresAt: new Date(Date.now() - 1000) });
          expect(yield* wallet.restore(expiring)).toEqual(
            new ChallengeRefused(),
          );

          const issued = yield* wallet.enrollmentChallenge(
            new WalletClaim({
              username: Schema.decodeSync(Username)("pedro"),
              address: randomAddress(),
            }),
          );

          assertTagged(issued, "ChallengeIssued");

          const enrollment = issued.challenge;
          const invented = Schema.decodeSync(PasskeyChallenge)("A".repeat(43));

          expect(
            yield* wallet.restore(
              yield* restoreAssertion(wallet, auth, enrollment),
            ),
          ).toEqual(new ChallengeRefused());
          expect(
            yield* wallet.restore(
              yield* restoreAssertion(wallet, auth, invented),
            ),
          ).toEqual(new ChallengeRefused());

          const impostor = new SoftwareAuthenticator(passkeyOrigin);

          impostor.forge(fresh.id);
          expect(
            yield* wallet.restore(yield* restoreAssertion(wallet, impostor)),
          ).toEqual(new AssertionRefused());

          const stranger = new SoftwareAuthenticator(passkeyOrigin);

          stranger.forge("c3RyYW5nZXI");
          expect(
            yield* wallet.restore(yield* restoreAssertion(wallet, stranger)),
          ).toEqual(new NoBackup());
        }),
    );

    it.effect(
      "beginSession grants a session only for a fresh session challenge, the wallet's own credential and a verified user",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const auth = new SoftwareAuthenticator(passkeyOrigin);

          yield* enrollBackedWallet(wallet, auth, "maria");

          const credentialId = Option.getOrThrow(
            Option.fromNullishOr(auth.registered[0]),
          ).id;

          const fresh = () =>
            wallet
              .sessionChallenge()
              .pipe(
                Effect.flatMap((challenge) =>
                  sessionAssertion(auth, credentialId, challenge),
                ),
              );

          const granted = yield* beginningSession(yield* fresh());

          expect(granted.step).toEqual(new SessionBegun());
          expect(Option.isSome(granted.issued)).toBe(true);

          const reused = yield* fresh();

          expect((yield* beginningSession(reused)).step).toEqual(
            new SessionBegun(),
          );

          const replayed = yield* beginningSession(reused);

          expect(replayed.step).toEqual(new ChallengeRefused());
          expect(replayed.issued).toEqual(Option.none());

          const restoring = yield* beginningSession(
            yield* sessionAssertion(
              auth,
              credentialId,
              yield* wallet.restoreChallenge(),
            ),
          );

          expect(restoring.step).toEqual(new ChallengeRefused());
          expect(restoring.issued).toEqual(Option.none());

          auth.userVerified = false;

          const unverified = yield* beginningSession(yield* fresh());

          expect(unverified.step).toEqual(new AssertionRefused());
          expect(unverified.issued).toEqual(Option.none());
          auth.userVerified = true;

          const impostor = new SoftwareAuthenticator(passkeyOrigin);

          impostor.forge(credentialId);

          const forged = yield* beginningSession(
            yield* sessionAssertion(
              impostor,
              credentialId,
              yield* wallet.sessionChallenge(),
            ),
          );

          expect(forged.step).toEqual(new AssertionRefused());
          expect(forged.issued).toEqual(Option.none());

          const stranger = new SoftwareAuthenticator(passkeyOrigin);

          stranger.forge("c3RyYW5nZXI");

          const unknown = yield* beginningSession(
            yield* sessionAssertion(
              stranger,
              Schema.decodeSync(CredentialId)("c3RyYW5nZXI"),
              yield* wallet.sessionChallenge(),
            ),
          );

          expect(unknown.step).toEqual(new NoBackup());
          expect(unknown.issued).toEqual(Option.none());
        }),
    );

    it.effect("a stored signature counter never moves backwards", () =>
      Effect.gen(function* () {
        const wallet = yield* Wallet;
        const auth = new SoftwareAuthenticator(passkeyOrigin);

        yield* enrollBackedWallet(wallet, auth, "maria");

        const stored = Option.getOrThrow(
          Option.fromNullishOr((yield* backupRows)[0]),
        );

        const store = yield* Backups;
        const credential = Schema.decodeSync(CredentialId)(stored.credentialId);

        yield* store.advance(credential, 7);
        yield* store.advance(credential, 3);

        expect(
          Option.getOrThrow(Option.fromNullishOr((yield* backupRows)[0]))
            .counter,
        ).toBe(7);
      }),
    );
  },
);
