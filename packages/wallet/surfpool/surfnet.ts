import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { TOKEN_PROGRAM_ADDRESS, getMintEncoder } from "@solana-program/token";
import { getBase16Decoder, none } from "@solana/kit";
import {
  ORCHID_LINKS_PROGRAM_ADDRESS,
  USDC_MINT_ADDRESS,
} from "@workspace/orchid-links";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import { type SolanaRpc, solanaRpc } from "../src/solana/rpc.server";

const slotMilliseconds = 40;

const programPath = new URL(
  "../../../target/deploy/orchid_links.so",
  import.meta.url,
);

const base16Decoder = getBase16Decoder();

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
          "--slot-time",
          String(slotMilliseconds),
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

export class Surfnet extends Context.Service<
  Surfnet,
  SolanaRpc & { readonly url: string }
>()("@workspace/wallet/surfpool/Surfnet") {}

export const surfnetLayer = Layer.effect(
  Surfnet,
  Effect.gen(function* () {
    const port = yield* freePort;
    const url = `http://127.0.0.1:${port}`;

    yield* surfpool(port, yield* freePort);

    const rpc = solanaRpc(
      yield* HttpClient.HttpClient,
      url,
      Duration.seconds(5),
    );

    yield* rpc
      .call("getHealth", [], Schema.Literal("ok"))
      .pipe(Effect.retry({ schedule: Schedule.spaced(100), times: 100 }));

    const program = yield* Effect.promise(() => readFile(programPath));

    yield* rpc.call(
      "surfnet_writeProgram",
      [ORCHID_LINKS_PROGRAM_ADDRESS, base16Decoder.decode(program), 0],
      Schema.Json,
    );

    yield* rpc.call(
      "surfnet_setAccount",
      [
        USDC_MINT_ADDRESS,
        {
          owner: TOKEN_PROGRAM_ADDRESS,
          data: base16Decoder.decode(
            getMintEncoder().encode({
              mintAuthority: none(),
              supply: 1_000_000_000_000n,
              decimals: 6,
              isInitialized: true,
              freezeAuthority: none(),
            }),
          ),
          lamports: 10_000_000,
          executable: false,
        },
      ],
      Schema.Json,
    );

    return { ...rpc, url };
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
