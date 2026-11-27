import { expect, layer } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { type TransferDraft } from "../src/contract";
import { Applied, Rejected } from "../src/server/Chain.server";
import { readEnvelope } from "../src/stellar/envelopes";
import { assertTagged } from "./tagged";
import {
  approve,
  authorizeTransfer,
  draftTransfer,
  findTransfer,
  fundHolder,
  fundedWallet,
  selfOrder,
  send,
  settleHash,
  authorizedTransfers,
  sweep,
  useDisposableDatabase,
  walletTestLayer,
  walletWithChain,
  world,
} from "./stellar-harness";

useDisposableDatabase();

const paymentSequence = (draft: TransferDraft) => {
  const facts = Option.getOrThrow(readEnvelope(draft.request.envelope));

  assertTagged(facts, "PaymentFacts");

  return facts.sequence;
};

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "double tap redrafts a still-live stale sequence before accepting its approval",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const first = selfOrder(key);
          const second = selfOrder(key);
          const firstDraft = yield* draftTransfer(first);
          const secondDraft = yield* draftTransfer(second);

          expect(paymentSequence(firstDraft)).toBe("1001");
          expect(paymentSequence(secondDraft)).toBe("1001");
          yield* send(first, approve(firstDraft.request, key));

          const signed = Option.getOrThrow(yield* findTransfer(first.id));

          assertTagged(signed, "Authorized");
          fundHolder(key, { sequence: "1001" });
          settleHash(signed.sealed.hash);
          expect((yield* send(first))._tag).toBe("Settled");

          const redrafted = yield* send(
            second,
            approve(secondDraft.request, key),
          );

          assertTagged(redrafted, "TransferDraft");
          expect(paymentSequence(redrafted)).toBe("1002");
          expect(Option.getOrThrow(yield* findTransfer(second.id))._tag).toBe(
            "Proposed",
          );
          expect(
            (yield* send(second, approve(redrafted.request, key)))._tag,
          ).toBe("Pending");
        }),
    );

    it.effect(
      "SlotTaken reconciliation refreshes the waiting draft after the holder consumes its sequence",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const first = selfOrder(key);
          const second = selfOrder(key);
          const firstDraft = yield* draftTransfer(first);
          const secondDraft = yield* draftTransfer(second);

          yield* send(first, approve(firstDraft.request, key));
          const signed = Option.getOrThrow(yield* findTransfer(first.id));

          assertTagged(signed, "Authorized");

          const settlingWallet = walletWithChain((actual) => ({
            settlement: (sealed) =>
              sealed.hash === signed.sealed.hash
                ? Effect.sync(() => {
                    fundHolder(key, { sequence: "1001" });

                    return new Applied({ at: DateTime.nowUnsafe() });
                  })
                : actual.settlement(sealed),
          }));

          const result = yield* send(
            second,
            approve(secondDraft.request, key),
          ).pipe(Effect.provide(settlingWallet));

          assertTagged(result, "TransferDraft");
          expect(paymentSequence(result)).toBe("1002");
          expect((yield* send(second, approve(result.request, key)))._tag).toBe(
            "Pending",
          );
        }),
    );

    it.effect(
      "a proven consumed authorization concludes and releases the sender slot",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);
          const { authorized } = yield* authorizeTransfer(key, order);

          fundHolder(key, { sequence: "1001" });
          world.evidence.set(
            authorized.sealed.hash,
            new Rejected({ code: "sequence_consumed" }),
          );
          yield* sweep;
          expect((yield* send(order))._tag).toBe("Failed");
          expect(yield* authorizedTransfers).toHaveLength(0);

          const nextOrder = selfOrder(key);
          const next = yield* draftTransfer(nextOrder);

          expect(paymentSequence(next)).toBe("1002");
          expect(
            (yield* send(nextOrder, approve(next.request, key)))._tag,
          ).toBe("Pending");
        }),
    );

    it.effect(
      "a sequence change during signing redrafts before durable authorization",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);
          const draft = yield* draftTransfer(order);

          const advancingWallet = walletWithChain((actual) => ({
            seal: (request, approval, holder) =>
              actual
                .seal(request, approval, holder)
                .pipe(
                  Effect.tap(() =>
                    Effect.sync(() => fundHolder(key, { sequence: "1001" })),
                  ),
                ),
          }));

          const result = yield* send(order, approve(draft.request, key)).pipe(
            Effect.provide(advancingWallet),
          );

          assertTagged(result, "TransferDraft");
          expect(paymentSequence(result)).toBe("1002");
          expect(Option.getOrThrow(yield* findTransfer(order.id))._tag).toBe(
            "Proposed",
          );
          expect(yield* authorizedTransfers).toHaveLength(0);
        }),
    );
  },
);
