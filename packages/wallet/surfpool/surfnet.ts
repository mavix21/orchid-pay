import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import { type SolanaRpc, solanaRpc } from "../src/solana/rpc.server";

const Bound = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Int }));

const freePort = Effect.callback<number>((resume) => {
  const server = createServer();

  server.listen(0, "127.0.0.1", () => {
    const bound = server.address();

    server.close(() => resume(Effect.succeed(Bound(bound).port)));
  });
});

const surfpool = (port: number, subscriptionPort: number) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      spawn(
        "surfpool",
        [
          "start",
          "--offline",
          "--ci",
          "--no-deploy",
          "--airdrop-amount",
          "0",
          "--port",
          String(port),
          "--ws-port",
          String(subscriptionPort),
          "--log-level",
          "none",
        ],
        { stdio: "ignore" },
      ),
    ),
    (child) =>
      Effect.promise(async () => {
        if (child.exitCode !== null) return;

        const exited = once(child, "exit");

        child.kill("SIGKILL");
        await exited;
      }),
  );

export class Surfnet extends Context.Service<Surfnet, SolanaRpc>()(
  "@workspace/wallet/surfpool/Surfnet",
) {}

export const surfnetLayer = Layer.effect(
  Surfnet,
  Effect.gen(function* () {
    const port = yield* freePort;

    yield* surfpool(port, yield* freePort);

    const rpc = solanaRpc(
      yield* HttpClient.HttpClient,
      `http://127.0.0.1:${port}`,
      Duration.seconds(5),
    );

    yield* rpc
      .call("getHealth", [], Schema.Literal("ok"))
      .pipe(Effect.retry({ schedule: Schedule.spaced(100), times: 100 }));

    return rpc;
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
