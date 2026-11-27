import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type * as Latch from "effect/Latch";
import * as Layer from "effect/Layer";
import type * as HttpClientError from "effect/http/HttpClientError";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as TestClock from "effect/testing/TestClock";
import { PayoutPartner } from "../src/server/PayoutPartner.server";
import { RateLimits } from "../src/server/RateLimits.server";
import { Wallet } from "../src/server/Wallet.server";
import {
  httpClientAnswering,
  jsonResponse,
  rpcMethod,
  testRpcUrl,
} from "./rpc-answering";
import { fakeHumanCheck, recordingQueue } from "./ledger-world";
import { settingsFor } from "./stellar-settings";
import { payoutCompletesAfter } from "./wallet-scenarios";
import { stellarChainLayer } from "../src/stellar/chain.server";

export const stellarWallet = (
  reply: (
    method: string,
    req: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<Response, HttpClientError.HttpClientError>,
) =>
  Layer.fresh(Wallet.serviceLayer).pipe(
    Layer.provide(recordingQueue),
    Layer.provide(RateLimits.unlimited),
    Layer.provide(fakeHumanCheck),
    Layer.provide(Layer.fresh(stellarChainLayer)),
    Layer.provide(PayoutPartner.sandbox(payoutCompletesAfter)),
    Layer.provide(settingsFor(testRpcUrl)),
    Layer.provide(httpClientAnswering((req) => reply(rpcMethod(req), req))),
  );

export const stellarAnswering = (reply: (method: string) => string) =>
  stellarWallet((method) => Effect.succeed(jsonResponse(reply(method))));

export const timeOutRpc = <A, E, R>(
  started: Latch.Latch,
  run: Effect.Effect<A, E, R>,
) =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      Effect.gen(function* () {
        yield* TestClock.setTime(now);
        const attempt = yield* Effect.forkChild(run);

        yield* started.await;
        yield* TestClock.adjust("10 seconds");

        return yield* Fiber.join(attempt);
      }).pipe(Effect.provide(TestClock.layer())),
    ),
  );
