import "fake-indexeddb/auto";
import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import {
  BackupEnrollment,
  ChallengeRefused,
  PaymentLinkRecipient,
  TransferId,
  TransferOrder,
  baseAsset,
  HumanCheckRefused,
  Offline,
  RecipientCheck,
  Username,
  UsernameRecipient,
  WalletClaim,
  type WalletPort,
} from "../src/contract";
import type { RelyingParty } from "../src/device/assertion";
import { browserKeyStore } from "../src/device/browser-key-store";
import {
  type EnrollmentDependencies,
  EnrollmentPending,
  type PendingEnrollmentStorage,
  makeEnrollmentEffects,
} from "../src/device/enrollment";
import { reopenLocalEnvelope } from "../src/device/local-envelope";
import { Principal, type SessionGrant } from "../src/server/Principal.server";
import { Wallet } from "../src/server/Wallet.server";
import { network } from "../src/device-network";
import { clearDatabase, relyingParty } from "./sealed-wallet-fixtures";
import { settlingOpenings } from "./settling-openings";
import { SoftwareAuthenticator } from "./software-authenticator";
import { assertTagged } from "./tagged";

import {
  memoryPendingStorage,
  restoreBackupPhrase,
  tableRows,
} from "./enrollment-fixtures";
import { memoryKeyStore, signingKey } from "./device-fixtures";
import { linkFixture } from "./solana-device-fixtures";
import {
  approve,
  checkRecipient,
  dbLayer,
  linkAmount,
  openSender,
  passBlockhashWindows,
  passkeyOrigin,
  reserveSponsor,
  settleHash,
  settleOnSubmit,
  useDisposableDatabase,
  walletForDb,
  walletTestLayer,
  world,
} from "./solana-harness";

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
    it.effect(
      "creates a wallet with two passkey prompts and opens it with the second: the username is bound with the signed opening",
      () =>
        Effect.gen(function* () {
          yield* Effect.promise(clearDatabase);

          const wallet = settlingOpenings(yield* Wallet);
          const auth = new SoftwareAuthenticator(passkeyOrigin);
          const tab = enrollmentFor(wallet, auth, memoryPendingStorage());

          world.humanCheckRefused = true;
          expect(yield* tab.start("maria")).toEqual(new HumanCheckRefused());
          expect(auth.registered).toHaveLength(0);
          world.humanCheckRefused = false;

          const started = yield* tab.start("maria");

          assertTagged(started, "EnrollmentPending");
          expect(started.stage).toBe("activate");
          assertTagged(
            Option.getOrThrow(Option.fromNullishOr(started.review)),
            "OpeningReview",
          );
          expect(auth.issued).toHaveLength(0);
          expect(yield* browserKeyStore.readSealed()).toEqual(Option.none());

          const beforeActivation = yield* tableRows;

          expect(beforeActivation.backups).toEqual([]);
          expect(beforeActivation.usernames).toEqual([]);
          expect(world.submitted).toHaveLength(0);

          auth.cancels = true;
          expect((yield* tab.advance(started.review))._tag).toBe(
            "PasskeyCancelled",
          );
          expect(yield* browserKeyStore.readSealed()).toEqual(Option.none());
          expect(world.submitted).toHaveLength(0);
          expect(yield* tab.pending()).toEqual(Option.some(started));

          auth.cancels = false;

          const completed = yield* tab.advance(started.review);

          assertTagged(completed, "WalletEnrolled");
          expect(completed.profile.username).toBe("maria");
          expect(auth.registered).toHaveLength(1);
          expect(auth.issued).toHaveLength(1);
          expect(yield* tab.pending()).toEqual(Option.none());
          expect(world.submitted).toHaveLength(1);

          const persisted = Option.getOrThrow(
            yield* browserKeyStore.readSealed(),
          );

          expect(persisted.public.backup).toBe("stored");
          expect(persisted.public.reserveSponsor).toBe(reserveSponsor);

          const rows = yield* tableRows;

          expect(rows.backups).toHaveLength(1);
          expect(rows.usernames).toHaveLength(1);

          const opened = yield* wallet.overview(completed.profile.address);

          assertTagged(opened, "Holding");
          expect(opened.profile).toEqual(completed.profile);
          expect(
            yield* checkRecipient(
              UsernameRecipient.make({
                value: Schema.decodeSync(Username)("maria"),
              }),
            ),
          ).toEqual(
            new RecipientCheck({
              recipient: completed.profile,
              memoRequired: false,
              exchange: Option.none(),
            }),
          );

          const reopened = yield* reopenLocalEnvelope(
            auth.assertions,
            relyingParty,
            persisted.credential,
            persisted.envelope,
            {
              network,
              address: persisted.public.address,
              purpose: "approval",
            },
          );

          assertTagged(reopened, "PhraseOpened");

          const localPhrase = Redacted.value(reopened.phrase);
          const restoredBackup = yield* restoreBackupPhrase(wallet, auth);

          expect(signingKey(localPhrase).publicKey()).toBe(
            completed.profile.address,
          );
          expect(restoredBackup.phrase).toBe(localPhrase);
          expect(restoredBackup.profile).toEqual(completed.profile);
          expect((yield* tab.start("pedro"))._tag).toBe("WalletOnDevice");
        }),
    );

    it.effect(
      "installs only one wallet when two tabs activate concurrently and releases only the winner",
      () =>
        Effect.gen(function* () {
          yield* Effect.promise(clearDatabase);

          const wallet = settlingOpenings(yield* Wallet);
          const firstAuth = new SoftwareAuthenticator(passkeyOrigin);
          const secondAuth = new SoftwareAuthenticator(passkeyOrigin);

          const installLock = Semaphore.makeUnsafe(1);

          const exclusive = <A, E>(run: Effect.Effect<A, E>) =>
            installLock.withPermit(run);

          const firstTab = enrollmentFor(
            wallet,
            firstAuth,
            undefined,
            relyingParty,
            exclusive,
          );

          const secondTab = enrollmentFor(
            wallet,
            secondAuth,
            undefined,
            relyingParty,
            exclusive,
          );

          const firstStarted = yield* firstTab.start("maria");
          const secondStarted = yield* secondTab.start("pedro");

          assertTagged(firstStarted, "EnrollmentPending");
          assertTagged(secondStarted, "EnrollmentPending");

          const outcomes = yield* Effect.all(
            [
              firstTab.advance(firstStarted.review),
              secondTab.advance(secondStarted.review),
            ],
            { concurrency: "unbounded" },
          );

          const winner = Option.getOrThrow(
            Option.fromNullishOr(
              outcomes.find(Predicate.isTagged("WalletEnrolled")),
            ),
          );

          const loser = Option.getOrThrow(
            Option.fromNullishOr(
              outcomes.find(Predicate.isTagged("WalletOnDevice")),
            ),
          );

          assertTagged(winner, "WalletEnrolled");
          expect(loser._tag).toBe("WalletOnDevice");

          const persisted = Option.getOrThrow(
            yield* browserKeyStore.readSealed(),
          );

          expect(persisted.public.address).toBe(winner.profile.address);
          expect(world.submitted).toHaveLength(1);
          expect((yield* tableRows).usernames).toHaveLength(1);
          expect((yield* tableRows).backups).toHaveLength(1);
        }),
    );

    it.effect(
      "an enrollment grants a wallet session only on the request that commits its backup",
      () =>
        Effect.gen(function* () {
          yield* Effect.promise(clearDatabase);

          const wallet = yield* Wallet;
          const auth = new SoftwareAuthenticator(passkeyOrigin);
          const grants = new Array<Option.Option<SessionGrant>>();

          const enrollingAtRequest: WalletPort["enroll"] = (
            enrollment,
            approvals,
          ) =>
            Effect.gen(function* () {
              const step = yield* (yield* Wallet).enroll(enrollment, approvals);

              grants.push(yield* (yield* Principal).issued);
              replayable = [enrollment, approvals];

              return step;
            }).pipe(
              Effect.provide(Layer.fresh(walletForDb(dbLayer))),
              Effect.orDie,
            );

          let replayable: Parameters<WalletPort["enroll"]> | undefined;

          const tab = enrollmentFor(
            settlingOpenings({ ...wallet, enroll: enrollingAtRequest }),
            auth,
          );

          const started = yield* tab.start("maria");

          assertTagged(started, "EnrollmentPending");
          assertTagged(yield* tab.advance(started.review), "WalletEnrolled");

          expect(grants.map(Option.isSome)).toEqual([true]);

          const [enrollment, approvals] = Option.getOrThrow(
            Option.fromNullishOr(replayable),
          );

          const replayed = yield* enrollingAtRequest(enrollment, approvals);

          expect(replayed._tag).toBe("Opened");
          expect(grants.map(Option.isSome)).toEqual([true, false]);
        }),
    );

    it.effect(
      "resumes a release whose backup commit was lost across reload without another prompt",
      () =>
        Effect.gen(function* () {
          yield* Effect.promise(clearDatabase);

          const wallet = settlingOpenings(yield* Wallet);
          const auth = new SoftwareAuthenticator(passkeyOrigin);
          const pending = memoryPendingStorage();

          let dropCommittedResponse = true;

          const flakyPort: WalletPort = {
            ...wallet,
            enroll: (enrollment, approvals) =>
              dropCommittedResponse
                ? wallet
                    .enroll(enrollment, approvals)
                    .pipe(Effect.andThen(Effect.fail(new Offline())))
                : wallet.enroll(enrollment, approvals),
          };

          const firstTab = enrollmentFor(flakyPort, auth, pending);

          const started = yield* firstTab.start("maria");

          assertTagged(started, "EnrollmentPending");
          expect((yield* firstTab.advance(started.review))._tag).toBe(
            "Offline",
          );
          expect(auth.issued).toHaveLength(1);

          const committed = yield* tableRows;

          expect(committed.backups).toHaveLength(1);
          expect(committed.usernames).toHaveLength(1);
          expect(yield* browserKeyStore.readSealed()).toEqual(Option.none());

          const restorable = yield* restoreBackupPhrase(wallet, auth);

          expect(restorable.profile.username).toBe("maria");

          const savedRelease = Option.getOrThrow(pending.readSync());

          assertTagged(savedRelease, "PendingRelease");

          const mismatchedRetry = yield* wallet.enroll(
            new BackupEnrollment({
              ...savedRelease.enrollment,
              username: Schema.decodeSync(Username)("pedro"),
            }),
            savedRelease.approvals,
          );

          expect(mismatchedRetry._tag).toBe("ChallengeRefused");

          const impostor = new SoftwareAuthenticator(passkeyOrigin);

          const issued = yield* wallet.enrollmentChallenge(
            new WalletClaim({
              username: savedRelease.enrollment.username,
              address: savedRelease.enrollment.address,
            }),
          );

          assertTagged(issued, "ChallengeIssued");

          const impostorRegistration = Option.getOrThrow(
            yield* impostor.registration.register({
              challenge: issued.challenge,
              username: savedRelease.enrollment.username,
            }),
          );

          expect(
            yield* wallet.enroll(
              new BackupEnrollment({
                ...savedRelease.enrollment,
                registration: impostorRegistration,
              }),
              savedRelease.approvals,
            ),
          ).toEqual(new ChallengeRefused());
          expect(
            (yield* tableRows).backups.map((row) => row.credentialId),
          ).toEqual(committed.backups.map((row) => row.credentialId));

          dropCommittedResponse = false;

          const reloadedTab = enrollmentFor(wallet, auth, pending);

          expect(yield* reloadedTab.pending()).toEqual(
            Option.some(
              new EnrollmentPending({
                stage: "release",
                username: Schema.decodeSync(Username)("maria"),
              }),
            ),
          );

          const completed = yield* reloadedTab.advance();

          assertTagged(completed, "WalletEnrolled");
          expect(completed.profile.address).toBe(committed.backups[0]?.address);
          expect(auth.issued).toHaveLength(1);
          expect(yield* reloadedTab.pending()).toEqual(Option.none());

          const persisted = Option.getOrThrow(
            yield* browserKeyStore.readSealed(),
          );

          expect(persisted.credential.id).toBe(auth.registered[0]?.id);
        }),
    );

    it.effect(
      "enrolling from a link receives it into the new wallet when the opening settles after the receive's blockhash could have landed",
      () =>
        Effect.gen(function* () {
          yield* Effect.promise(clearDatabase);

          const { wallet, sender } = yield* openSender(memoryKeyStore());
          const { code, link } = linkFixture();

          const funding = new TransferOrder({
            id: Schema.decodeSync(TransferId)(crypto.randomUUID()),
            from: sender.address,
            to: PaymentLinkRecipient.make({ value: link }),
            asset: baseAsset,
            amount: linkAmount,
          });

          const fundingDraft = yield* wallet.transfer(funding, Option.none());

          assertTagged(fundingDraft, "TransferDraft");
          yield* settleOnSubmit(wallet, sender.address)(
            funding,
            approve(fundingDraft.request, signingKey(sender.phrase)),
          );
          assertTagged(
            yield* wallet.transfer(funding, Option.none()),
            "Settled",
          );

          let unsettledOpening: string | undefined;

          const settleLatest = Effect.sync(() => {
            const sealed = world.submitted.at(-1);

            if (sealed) settleHash(sealed.hash);
          });

          const slowOpening: WalletPort = {
            ...wallet,
            enroll: (enrollment, approvals) =>
              wallet.enroll(enrollment, approvals).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    unsettledOpening = world.submitted.at(-1)?.hash;
                  }),
                ),
              ),
            open: (claim, approvals) =>
              Effect.sync(() => {
                if (unsettledOpening === undefined) return;

                settleHash(unsettledOpening);
                passBlockhashWindows();
                unsettledOpening = undefined;
              }).pipe(Effect.andThen(wallet.open(claim, approvals))),
            manage: (order, approval) =>
              wallet
                .manage(order, approval)
                .pipe(
                  Effect.tap(() =>
                    Option.isSome(approval) ? settleLatest : Effect.void,
                  ),
                ),
          };

          const tab = enrollmentFor(
            slowOpening,
            new SoftwareAuthenticator(passkeyOrigin),
            memoryPendingStorage(),
          );

          assertTagged(yield* tab.start("newbie"), "EnrollmentPending");

          const reviewed = yield* tab.reviewReceive(code);

          assertTagged(reviewed, "EnrollmentPending");

          const shownReceive = Option.getOrThrow(
            Option.fromNullishOr(reviewed.receive),
          );

          const completed = yield* tab.advance(reviewed.review, {
            review: shownReceive,
            code,
          });

          assertTagged(completed, "WalletEnrolled");
          expect({
            receivedLink: completed.receivedLink,
            received: completed.received?._tag,
            unclaimed: world.claimables.has(shownReceive.unclaimedFunds),
          }).toEqual({
            receivedLink: link,
            received: "AssetSettled",
            unclaimed: false,
          });
        }),
    );
  },
);
