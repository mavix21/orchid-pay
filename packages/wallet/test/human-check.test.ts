import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import { HumanCheckRefused, HumanCheckToken } from "../src/contract";
import { HumanCheck } from "../src/server/HumanCheck.server";
import { WalletSettings } from "../src/server/settings.server";
import { bodyText, httpClientAnswering, jsonResponse } from "./http-answering";

const secret = "siteverify-secret";
const token = Schema.decodeSync(HumanCheckToken)("token-from-the-widget");

const humanCheckAnswering = (
  reply: (request: HttpClientRequest.HttpClientRequest) => Response,
) =>
  HumanCheck.layer.pipe(
    Layer.provide(
      Layer.succeed(WalletSettings, {
        rpcUrl: "https://rpc.test",
        sponsorSecret: Redacted.make("unused"),
        passkeyOrigins: [],
        humanCheckSecret: Redacted.make(secret),
        sessionSecret: Redacted.make("unused"),
      }),
    ),
    Layer.provide(
      httpClientAnswering((request) => Effect.succeed(reply(request))),
    ),
  );

const verifyWith = (
  reply: (request: HttpClientRequest.HttpClientRequest) => Response,
  presented: Option.Option<HumanCheckToken> = Option.some(token),
) =>
  HumanCheck.use((check) => check.verify(presented)).pipe(
    Effect.provide(humanCheckAnswering(reply)),
  );

it.effect.each([
  [
    "a passing check",
    () => jsonResponse(JSON.stringify({ success: true })),
    Option.none(),
  ],
  [
    "a reused or expired token",
    () =>
      jsonResponse(
        JSON.stringify({
          success: false,
          "error-codes": ["timeout-or-duplicate"],
        }),
      ),
    Option.some(new HumanCheckRefused()),
  ],
  [
    "an invalid token",
    () =>
      jsonResponse(
        JSON.stringify({
          success: false,
          "error-codes": ["invalid-input-response"],
        }),
      ),
    Option.some(new HumanCheckRefused()),
  ],
  [
    "a failure without error codes",
    () => jsonResponse(JSON.stringify({ success: false })),
    Option.some(new HumanCheckRefused()),
  ],
] as const)("Siteverify answering %s", ([, reply, verdict]) =>
  Effect.gen(function* () {
    expect(yield* verifyWith(reply)).toEqual(verdict);
  }),
);

it.effect.each([
  [
    "a rejected secret",
    () =>
      jsonResponse(
        JSON.stringify({
          success: false,
          "error-codes": ["invalid-input-secret"],
        }),
      ),
  ],
  [
    "an internal error",
    () =>
      jsonResponse(
        JSON.stringify({ success: false, "error-codes": ["internal-error"] }),
      ),
  ],
  ["a server error", () => new Response("down", { status: 502 })],
  ["a body that is not JSON", () => new Response("<html>", { status: 200 })],
] as const)(
  "Siteverify answering %s leaves the binding undecided",
  ([, reply]) =>
    Effect.gen(function* () {
      const failure = yield* verifyWith(reply).pipe(Effect.flip);

      expect(failure._tag).toBe("HumanCheckUnavailable");
    }),
);

it.effect("a missing token is refused", () =>
  Effect.gen(function* () {
    const verdict = yield* verifyWith(
      () => jsonResponse(JSON.stringify({ success: true })),
      Option.none(),
    );

    expect(verdict).toEqual(Option.some(new HumanCheckRefused()));
  }),
);

it.effect("Siteverify receives the secret and the token and nothing else", () =>
  Effect.gen(function* () {
    const sent: Array<{ url: string; body: string }> = [];

    yield* verifyWith((request) => {
      sent.push({
        url: request.url,
        body: bodyText(request),
      });

      return jsonResponse(JSON.stringify({ success: true }));
    });

    expect(sent).toEqual([
      {
        url: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        body: new URLSearchParams({ secret, response: token }).toString(),
      },
    ]);
  }),
);
