import { expect, layer } from "@effect/vitest";
import { Keypair } from "@stellar/stellar-sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { AddressBound, Opened, Profile } from "../src/contract";
import { readEnvelope } from "../src/stellar/envelopes";
import { assertTagged } from "./tagged";
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
} from "./stellar-harness";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect("missing trustline reopens with the same username and key", () =>
      Effect.gen(function* () {
        const key = Keypair.random();
        const claim = yield* create(key, "maria");

        world.accounts.set(
          claim.address,
          accountState({ sequence: "2000", balance: Option.none() }),
        );
        expect((yield* overviewOf(claim.address))._tag).toBe("NeedsReopening");
        expect(
          (yield* findWallet(claim.address)).pipe(Option.map((r) => r.status)),
        ).toEqual(Option.some("recovered"));
        yield* create(key, "maria");
        expect((yield* overviewOf(claim.address))._tag).toBe("Holding");
      }),
    );

    it.effect(
      "a partially sponsored account is refused before a username binds",
      () =>
        Effect.gen(function* () {
          const claim = claimFor(Keypair.random(), "maria");

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
          const key = Keypair.random();
          const claimA = claimFor(key, "alice");
          const claimB = claimFor(key, "bob");

          world.accounts.set(
            claimA.address,
            accountState({ balance: Option.some(amount("0")) }),
          );

          const draft = yield* opening(claimA);

          assertTagged(draft, "OpeningDraft");
          expect(
            Option.getOrThrow(readEnvelope(draft.request.envelope)),
          ).toMatchObject({ createAccount: false });
          expect(
            yield* opening(claimA, approveOpening(Keypair.random(), draft)),
          ).toEqual(draft);
          expect(
            (yield* opening(claimFor(Keypair.random(), "alice")))._tag,
          ).toBe("OpeningDraft");
          expect(
            (yield* opening(claimA, approveOpening(key, draft)))._tag,
          ).toBe("OpeningPending");
          yield* settleAttempt(claimA.address);
          expect(yield* opening(claimA)).toEqual(
            new Opened({ profile: new Profile(claimA) }),
          );
          expect(
            (yield* opening(claimFor(Keypair.random(), "alice")))._tag,
          ).toBe("UsernameTaken");
          expect(yield* opening(claimB)).toEqual(
            new AddressBound({ profile: new Profile(claimA) }),
          );
        }),
    );
  },
);
