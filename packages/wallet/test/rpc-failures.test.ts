import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Latch from "effect/Latch";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import { ServiceFailed } from "../src/contract";
import {
  jsonResponse,
  queriedHash,
  rpcOk,
  submittedTransaction,
  testnetReply,
} from "./rpc-answering";
import { stellarAnswering, stellarWallet, timeOutRpc } from "./stellar-wallet";
import { assertTagged } from "./tagged";
import {
  findTransfer,
  send,
  useDisposableDatabase,
  walletTestLayer,
  signedTransfer,
} from "./stellar-harness";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "answers ServiceFailed and keeps an authorized order on a malformed transaction lookup reply",
      () =>
        Effect.gen(function* () {
          const signed = yield* signedTransfer("maria");

          expect(
            yield* send(signed.order).pipe(
              Effect.provide(
                stellarAnswering(() =>
                  rpcOk({ entries: "none", status: "LOST" }),
                ),
              ),
              Effect.flip,
            ),
          ).toEqual(new ServiceFailed());
          expect(
            Option.getOrThrow(yield* findTransfer(signed.order.id))._tag,
          ).toBe("Authorized");
        }),
    );

    it.effect(
      "keeps an authorized transfer Pending on NOT_FOUND and submit timeout, then settles on replay without resubmitting",
      () =>
        Effect.gen(function* () {
          const signed = yield* signedTransfer("maria");
          const started = yield* Latch.make();
          const submitted: Array<string> = [];
          let settled = false;

          const stellar = stellarWallet((method, req) =>
            Match.value(method).pipe(
              Match.when("sendTransaction", () => {
                submitted.push(submittedTransaction(req));

                return started.open.pipe(Effect.andThen(Effect.never));
              }),
              Match.when("getTransaction", () =>
                Effect.succeed(
                  jsonResponse(
                    settled && queriedHash(req) === signed.hash
                      ? rpcOk({
                          status: "SUCCESS",
                          createdAt: "1795149020",
                          latestLedger: 5825076,
                          latestLedgerCloseTime: "1795149020",
                          oldestLedgerCloseTime: "1794544229",
                        })
                      : testnetReply(method),
                  ),
                ),
              ),
              Match.orElse(() =>
                Effect.succeed(jsonResponse(testnetReply(method))),
              ),
            ),
          );

          expect(
            (yield* timeOutRpc(
              started,
              send(signed.order).pipe(Effect.provide(stellar)),
            ))._tag,
          ).toBe("Pending");
          expect(submitted).toEqual([signed.envelope]);
          expect(
            Option.getOrThrow(yield* findTransfer(signed.order.id))._tag,
          ).toBe("Authorized");

          settled = true;

          const replayed = yield* send(signed.order).pipe(
            Effect.provide(stellar),
          );

          assertTagged(replayed, "Settled");
          expect(replayed.id).toBe(signed.order.id);
          expect(submitted).toEqual([signed.envelope]);
        }),
    );
  },
);
