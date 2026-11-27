import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { assertTagged } from "./tagged";
import {
  approve,
  draftTransfer,
  findTransfer,
  fundedWallet,
  passBlockhashWindows,
  selfOrder,
  send,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./solana-harness";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "an approval for a draft whose blockhash can no longer land redrafts instead of sealing",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);
          const draft = yield* draftTransfer(order);
          const submitted = world.submitted.length;

          passBlockhashWindows();

          const redrafted = yield* send(order, approve(draft.request, key));

          assertTagged(redrafted, "TransferDraft");
          expect(redrafted.request.envelope).not.toBe(draft.request.envelope);
          expect(Option.getOrThrow(yield* findTransfer(order.id))._tag).toBe(
            "Proposed",
          );
          expect(world.submitted).toHaveLength(submitted);
          expect(
            (yield* send(order, approve(redrafted.request, key)))._tag,
          ).toBe("Pending");
        }),
    );
  },
);
