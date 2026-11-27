import * as DateTime from "effect/DateTime";
import { AccountAddress, NotOpened, Opened, Profile } from "../src/contract";
import { Sealed } from "../src/server/Chain.server";
import { Directory } from "../src/server/Directory.server";
import { bindingAllowed } from "./wallet-harness";
import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Expired, Rejected } from "../src/server/Chain.server";
import { ReconcileOpening } from "../src/server/work-queue.server";
import { assertTagged } from "./tagged";
import {
  accountState,
  approveOpening,
  attend,
  claimFor,
  create,
  expireAttempt,
  findWallet,
  opening,
  overviewOf,
  sealLostOpening,
  settleAttempt,
  useDisposableDatabase,
  walletTestLayer,
  walletWithChain,
  world,
} from "./wallet-harness";
import { randomKey, type TestKey } from "./test-keys";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "an opening activates only from its key's signature once its account is on the network",
      () =>
        Effect.gen(function* () {
          const key = randomKey();
          const claim = claimFor(key, "maria");
          const draft = yield* opening(claim);

          assertTagged(draft, "OpeningDraft");
          expect(
            yield* opening(claim, approveOpening(randomKey(), draft)),
          ).toEqual(draft);
          expect(world.submitted).toHaveLength(0);
          expect((yield* opening(claim, approveOpening(key, draft)))._tag).toBe(
            "OpeningPending",
          );
          yield* settleAttempt(claim.address, 120);

          const visible = Option.getOrThrow(
            Option.fromNullishOr(world.accounts.get(claim.address)),
          );

          world.accounts.delete(claim.address);
          expect((yield* opening(claim))._tag).toBe("OpeningPending");
          expect(
            Option.getOrThrow(yield* findWallet(claim.address)).status,
          ).toBe("opening");
          world.accounts.set(claim.address, visible);
          expect(yield* opening(claim)).toEqual(
            new Opened({ profile: new Profile(claim) }),
          );
          expect(
            Option.getOrThrow(yield* findWallet(claim.address)).status,
          ).toBe("active");
        }),
    );

    it.effect.each([
      { name: "a new wallet's", arrange: (_key: TestKey) => Effect.void },
      {
        name: "a recovered wallet's",
        arrange: (key: TestKey) =>
          Effect.gen(function* () {
            const claim = yield* create(key, "maria");

            world.accounts.set(
              claim.address,
              accountState({ sequence: "2000", balance: Option.none() }),
            );
            assertTagged(yield* overviewOf(claim.address), "NeedsReopening");
          }),
      },
    ])(
      "a queue message resubmits $name sealed opening and activates it once its account is open, with no device call",
      ({ arrange }) =>
        Effect.gen(function* () {
          const key = randomKey();
          const claim = claimFor(key, "maria");

          yield* arrange(key);
          world.queued.length = 0;

          const hash = yield* sealLostOpening(key, claim);
          const message = new ReconcileOpening({ address: claim.address });

          expect(world.queued).toEqual([message]);
          assertTagged(yield* attend(message), "WorkRetry");
          expect(world.submitted.at(-1)?.hash).toBe(hash);
          assertTagged(yield* attend(message, 2), "WorkFinished");
          expect(
            Option.getOrThrow(yield* findWallet(claim.address)),
          ).toMatchObject({ status: "active", attemptHash: null });
        }),
    );

    it.effect.each([
      {
        name: "was rejected",
        arrange: (_address: AccountAddress, hash: string) =>
          Effect.sync(() => {
            world.evidence.set(hash, new Rejected({ code: "txFailed" }));
          }),
      },
      {
        name: "expired",
        arrange: (_address: AccountAddress, hash: string) =>
          Effect.sync(() => {
            world.evidence.set(hash, new Expired());
          }),
      },
      {
        name: "is past its window",
        arrange: (address: AccountAddress, _hash: string) =>
          expireAttempt(address),
      },
    ])(
      "a queue message clears an opening that $name without drafting another",
      ({ arrange }) =>
        Effect.gen(function* () {
          const key = randomKey();
          const claim = claimFor(key, "maria");
          const hash = yield* sealLostOpening(key, claim);

          yield* arrange(claim.address, hash);
          assertTagged(
            yield* attend(new ReconcileOpening({ address: claim.address })),
            "WorkFinished",
          );
          expect(
            Option.getOrThrow(yield* findWallet(claim.address)),
          ).toMatchObject({
            status: "opening",
            attemptEnvelope: null,
            attemptHash: null,
            attemptExpiresAt: null,
          });
          expect(world.submitted).toHaveLength(0);
          expect(yield* overviewOf(claim.address)).toEqual(
            new NotOpened({ profile: Option.some(new Profile(claim)) }),
          );
        }),
    );

    it.effect(
      "one missing RPC observation does not demote an active wallet",
      () =>
        Effect.gen(function* () {
          const claim = yield* create(randomKey(), "maria");
          let reads = 0;

          const transientWallet = walletWithChain((actual) => ({
            balance: (addr) =>
              ++reads === 1
                ? Effect.succeed(Option.none())
                : actual.balance(addr),
          }));

          expect(
            (yield* overviewOf(claim.address).pipe(
              Effect.provide(transientWallet),
            ))._tag,
          ).toBe("Holding");
          expect(
            Option.getOrThrow(yield* findWallet(claim.address)).status,
          ).toBe("active");
        }),
    );

    it.effect(
      "a sealed opening outside RPC history redrafts after the ledger passes maxTime",
      () =>
        Effect.gen(function* () {
          const key = randomKey();
          const claim = claimFor(key, "maria");
          const row = yield* Directory.use((d) => d.start(claim.address));

          const historical = new Sealed({
            envelope: "historical-opening",
            hash: "00".repeat(32),
            expiresAt: DateTime.makeUnsafe(Date.now() - 80_000),
          });

          yield* Directory.use((d) =>
            d.seal(row, historical, claim, bindingAllowed),
          );
          expect((yield* opening(claim))._tag).toBe("OpeningDraft");
          expect(world.submitted).toHaveLength(0);
          expect(
            Option.getOrThrow(yield* findWallet(claim.address)).attemptHash,
          ).toBeNull();
        }),
    );
  },
);
