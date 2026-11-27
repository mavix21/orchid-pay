import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AddressBound, Opened, Profile } from "../src/contract";
import { assertTagged } from "./tagged";
import { randomKey } from "./test-keys";
import {
  accountState,
  amount,
  approveOpening,
  claimFor,
  create,
  findWallet,
  opening,
  overviewOf,
  settleAttempt,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./solana-harness";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "a missing USDC account reopens with the same username and key",
      () =>
        Effect.gen(function* () {
          const key = randomKey();
          const claim = yield* create(key, "maria");

          world.accounts.set(
            claim.address,
            accountState({ sequence: "2000", balance: Option.none() }),
          );
          expect((yield* overviewOf(claim.address))._tag).toBe(
            "NeedsReopening",
          );
          expect(
            (yield* findWallet(claim.address)).pipe(
              Option.map((r) => r.status),
            ),
          ).toEqual(Option.some("recovered"));
          yield* create(key, "maria");
          expect((yield* overviewOf(claim.address))._tag).toBe("Holding");
        }),
    );

    it.effect(
      "a USDC account another party can close is refused before a username binds",
      () =>
        Effect.gen(function* () {
          const claim = claimFor(randomKey(), "maria");

          world.accounts.set(
            claim.address,
            accountState({
              balance: Option.some(amount("0")),
              accountSponsored: true,
              sponsored: false,
            }),
          );
          expect((yield* opening(claim))._tag).toBe("NotSponsored");
          expect(Option.isNone(yield* findWallet(claim.address))).toBe(true);
          expect(world.submitted).toHaveLength(0);
        }),
    );

    it.effect(
      "an existing unnamed account binds a username only with its key's signature",
      () =>
        Effect.gen(function* () {
          const key = randomKey();
          const claimA = claimFor(key, "alice");
          const claimB = claimFor(key, "bob");

          world.accounts.set(
            claimA.address,
            accountState({ balance: Option.some(amount("0")) }),
          );

          const draft = yield* opening(claimA);

          assertTagged(draft, "OpeningDraft");
          expect(
            yield* opening(claimA, approveOpening(randomKey(), draft)),
          ).toEqual(draft);
          expect((yield* opening(claimFor(randomKey(), "alice")))._tag).toBe(
            "OpeningDraft",
          );
          expect(
            (yield* opening(claimA, approveOpening(key, draft)))._tag,
          ).toBe("OpeningPending");
          yield* settleAttempt(claimA.address);
          expect(yield* opening(claimA)).toEqual(
            new Opened({ profile: new Profile(claimA) }),
          );
          expect((yield* opening(claimFor(randomKey(), "alice")))._tag).toBe(
            "UsernameTaken",
          );
          expect(yield* opening(claimB)).toEqual(
            new AddressBound({ profile: new Profile(claimA) }),
          );
        }),
    );
  },
);
