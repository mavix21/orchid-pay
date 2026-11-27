import { expect, it, layer } from "@effect/vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import {
  type Approvals,
  type AccountAddress,
  Offline,
  type OpenStep,
  Opened,
  OpeningDraft,
  OpeningPending,
  Profile,
  SigningRequest,
  Username,
  type WalletPort,
} from "../src/contract";
import {
  DraftRejected,
  SavedWallet,
  makeWalletEffects,
} from "../src/device/client";
import { Wallet } from "../src/server/Wallet.server";
import { signingScheme } from "../src/device-network";
import { approvalMargin, draftLifetime } from "../src/policy";
import {
  enrolledDeviceWallet,
  memoryKeyStore,
  signingKey,
  unusedPort,
} from "./device-fixtures";
import {
  approvingDevice,
  installSealedWallet,
  sealedKeyStore,
} from "./sealed-wallet-fixtures";
import { browserKeyStore } from "../src/device/browser-key-store";
import {
  PublicDeviceWallet,
  type SealedKeyStore,
} from "../src/device/key-store";
import { SoftwareAuthenticator } from "./software-authenticator";
import { assertTagged } from "./tagged";
import { randomAddress } from "./test-keys";
import { seededDeviceWallet, solanaDrafts } from "./solana-device-fixtures";
import {
  findWallet,
  passkeyOrigin,
  reserveSponsor,
  settleAttempt,
  useDisposableDatabase,
  walletTestLayer,
} from "./solana-harness";

const passkeys = new SoftwareAuthenticator(passkeyOrigin).passkeys;
const seeded = seededDeviceWallet(reserveSponsor);

const requestUntil = (envelope: SigningRequest["envelope"], maxTime: number) =>
  new SigningRequest({
    envelope,
    expiresAt: DateTime.makeUnsafe(maxTime * 1000),
  });

interface OpeningChange {
  readonly address?: AccountAddress;
  readonly sponsor?: AccountAddress;
  readonly lifetime?: number;
}

const openingAt = (millis: number, change: OpeningChange = {}) =>
  new OpeningDraft({
    request: requestUntil(
      solanaDrafts(change.sponsor ?? reserveSponsor).opening(
        change.address ?? seeded.address,
      ),
      Math.floor(millis / 1000) + (change.lifetime ?? draftLifetime),
    ),
  });

it.effect(
  "polls OpeningPending until the opening draft arrives and submits a valid approval",
  () =>
    Effect.gen(function* () {
      const enrolled = enrolledDeviceWallet();
      const key = signingKey(enrolled.phrase);
      const { auth } = yield* installSealedWallet(enrolled);
      const started = yield* Latch.make();
      let calls = 0;
      let drafted: OpeningDraft | undefined;
      let submitted: Approvals | undefined;

      const port = unusedPort({
        open: (claim, approvals) =>
          started.open.pipe(
            Effect.andThen(Clock.currentTimeMillis),
            Effect.map((millis): OpenStep => {
              calls += 1;

              if (calls < 3) return new OpeningPending();

              drafted ??= openingAt(millis, { address: claim.address });

              if (Option.isSome(approvals)) {
                submitted = approvals.value;

                return new Opened({ profile: new Profile(claim) });
              }

              return drafted;
            }),
          ),
      });

      const client = makeWalletEffects(
        port,
        sealedKeyStore,
        passkeys,
        approvingDevice(auth),
      );

      const attempt = yield* Effect.forkChild(client.reviewOpening("maria"));

      yield* started.await;
      yield* TestClock.adjust("10 seconds");

      const review = yield* Fiber.join(attempt);

      assertTagged(review, "OpeningReview");
      expect(yield* client.confirmOpening(review)).toBeInstanceOf(Opened);
      expect(submitted).toHaveLength(1);
      expect(yield* client.confirmOpening(review)).toEqual(new DraftRejected());
      expect(
        drafted !== undefined &&
          ed25519.verify(
            submitted?.[0]?.signature ?? new Uint8Array(),
            signingScheme.signingPayload(drafted.request.envelope),
            ed25519.getPublicKey(key.privateKey),
          ),
      ).toBe(true);
    }),
);

it.effect(
  "releases no signature when another tab renamed the wallet after the review was read",
  () =>
    Effect.gen(function* () {
      const enrolled = enrolledDeviceWallet();
      const { auth } = yield* installSealedWallet(enrolled);
      const released: Array<Option.Option<Approvals>> = [];
      let renamed = false;

      const racingStore: SealedKeyStore = {
        ...browserKeyStore,
        updatePublic: (update) =>
          Effect.suspend(() => {
            if (renamed) return Effect.void;

            renamed = true;

            return browserKeyStore.updatePublic((current) =>
              Option.some(
                new PublicDeviceWallet({
                  ...current,
                  username: Schema.decodeSync(Username)("other"),
                }),
              ),
            );
          }).pipe(Effect.andThen(browserKeyStore.updatePublic(update))),
      };

      const port = unusedPort({
        open: (_claim, approvals) =>
          Effect.map(Clock.currentTimeMillis, (millis): OpenStep => {
            released.push(approvals);

            return openingAt(millis, { address: enrolled.address });
          }),
      });

      const client = makeWalletEffects(
        port,
        sealedKeyStore,
        passkeys,
        approvingDevice(auth, racingStore),
      );

      const review = yield* client.reviewOpening("maria");

      assertTagged(review, "OpeningReview");
      expect(yield* client.confirmOpening(review)).toEqual(new DraftRejected());
      expect(released.filter(Option.isSome)).toHaveLength(0);
    }),
);

it.effect(
  "allows one redraft after a released opening and refuses the next replacement",
  () =>
    Effect.gen(function* () {
      const { auth } = yield* installSealedWallet(seeded);

      const port = unusedPort({
        open: () =>
          Effect.map(Clock.currentTimeMillis, (millis) => openingAt(millis)),
      });

      const client = makeWalletEffects(
        port,
        sealedKeyStore,
        passkeys,
        approvingDevice(auth),
      );

      const first = yield* client.reviewOpening("maria");

      assertTagged(first, "OpeningReview");

      const second = yield* client.confirmOpening(first);

      assertTagged(second, "OpeningReview");
      expect(second.redrafted).toBe(true);
      expect(yield* client.confirmOpening(second)).toEqual(new DraftRejected());
    }),
);

const rejectedDrafts: ReadonlyArray<readonly [string, OpenStep]> = [
  ["an expired opening draft", openingAt(Date.now(), { lifetime: -1 })],
  [
    "an opening that keeps expiring within the approval margin",
    openingAt(Date.now(), { lifetime: approvalMargin - 5 }),
  ],
  [
    "an opening drafted for another address",
    openingAt(Date.now(), { address: randomAddress() }),
  ],
  [
    "an opening whose fee payer is the wallet itself",
    openingAt(Date.now(), { sponsor: seeded.address }),
  ],
];

it.live.each(rejectedDrafts)("refuses %s without approving", ([, step]) =>
  Effect.gen(function* () {
    const approvals: Array<Option.Option<Approvals>> = [];

    const port = unusedPort({
      open: (_claim, approval) =>
        Effect.sync(() => {
          approvals.push(approval);

          return step;
        }),
    });

    const outcome = yield* makeWalletEffects(
      port,
      memoryKeyStore(Option.some(seeded)),
      passkeys,
    ).reviewOpening("maria");

    expect(outcome).toEqual(new DraftRejected());
    expect(approvals.filter(Option.isSome)).toHaveLength(0);
  }),
);

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "resumes an interrupted opening with the bound username even if another is typed",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const enrolled = enrolledDeviceWallet("maria");
          const { auth } = yield* installSealedWallet(enrolled);
          const device = approvingDevice(auth);
          let calls = 0;

          const interrupted: WalletPort = {
            ...wallet,
            open: (claim, approvals) =>
              ++calls === 3
                ? Effect.fail(new Offline())
                : wallet.open(claim, approvals),
          };

          const first = makeWalletEffects(
            interrupted,
            sealedKeyStore,
            passkeys,
            device,
          );

          const review = yield* first.reviewOpening("maria");

          assertTagged(review, "OpeningReview");
          expect((yield* first.confirmOpening(review))._tag).toBe("Offline");

          const resumed = makeWalletEffects(
            wallet,
            sealedKeyStore,
            passkeys,
            device,
          );

          expect(yield* resumed.saved()).toEqual(
            new SavedWallet({
              username: Schema.decodeSync(Username)("maria"),
              openingApproved: true,
              backup: "stored",
            }),
          );
          expect(
            (yield* findWallet(enrolled.address)).pipe(
              Option.map((r) => r.status),
            ),
          ).toEqual(Option.some("opening"));

          yield* settleAttempt(enrolled.address);

          const opened = yield* resumed.reviewOpening("pedro");

          expect(opened instanceof Opened && opened.profile.username).toBe(
            "maria",
          );
          expect(
            (yield* findWallet(enrolled.address)).pipe(
              Option.map((r) => r.status),
            ),
          ).toEqual(Option.some("active"));
        }),
    );
  },
);
