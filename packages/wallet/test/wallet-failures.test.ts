import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { RateLimited, ServiceFailed } from "../src/contract";
import { concealFailure } from "../src/server/failures.server";
import { assertTagged } from "./tagged";
import {
  findTransfer,
  settleHash,
  sweep,
  useDisposableDatabase,
  walletTestLayer,
  world,
  signedTransfer,
} from "./wallet-harness";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect("answers a rate refusal as RateLimited, not ServiceFailed", () =>
      Effect.gen(function* () {
        const refusal = yield* new RateLimited().pipe(
          Effect.catchCause(concealFailure),
          Effect.flip,
        );

        assertTagged(refusal, "RateLimited");
      }),
    );

    it.effect("keeps sweeping other records after one record's read dies", () =>
      Effect.gen(function* () {
        const unreadable = yield* signedTransfer("maria");
        const readable = yield* signedTransfer("lucia");

        world.unreadable.add(unreadable.hash);
        settleHash(readable.hash);

        expect(yield* sweep.pipe(Effect.flip)).toEqual(new ServiceFailed());
        expect(
          Option.getOrThrow(yield* findTransfer(readable.order.id))._tag,
        ).toBe("Concluded");
      }),
    );

    it.effect(
      "keeps reconciling transfers when the unclaimed funds read fails",
      () =>
        Effect.gen(function* () {
          const signed = yield* signedTransfer("maria");

          world.claimablesDown = true;
          settleHash(signed.hash);

          expect(yield* sweep.pipe(Effect.flip)).toEqual(new ServiceFailed());
          expect(
            Option.getOrThrow(yield* findTransfer(signed.order.id))._tag,
          ).toBe("Concluded");
        }),
    );
  },
);
