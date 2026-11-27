import { env } from "cloudflare:workers";
import {
  getCookie,
  getRequestHeader,
  getRequestUrl,
  setCookie,
} from "@tanstack/react-start/server";
import { databaseLayer } from "@workspace/db";
import { type AccountAddress, ServerFailure } from "@workspace/wallet";
import {
  ClientAddress,
  PaymentRequests,
  PayoutPartner,
  Principal,
  RequestPayments,
  SessionCookie,
  type SessionGrant,
  Wallet,
  WalletSettings,
  concealFailure,
} from "@workspace/wallet/server";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { rateLimitsLayer } from "./rate-limits.server";
import { workQueueLayer } from "./work-queue.server";

const walletSettingsLayer = Layer.suspend(() =>
  Layer.succeed(WalletSettings, {
    rpcUrl: env.STELLAR_RPC_URL,
    reserveSponsorSecret: Redacted.make(env.RESERVE_SPONSOR_SECRET),
    feePayerSecret: Redacted.make(env.FEE_PAYER_SECRET),
    passkeyOrigins: env.PASSKEY_ORIGINS.split(","),
    humanCheckSecret: Redacted.make(env.TURNSTILE_SECRET_KEY),
    sessionSecret: Redacted.make(env.SESSION_SECRET),
  }),
);

const payoutPartnerLayer = Layer.suspend(() =>
  Match.value(env.PAYOUT_PARTNER).pipe(
    Match.when("sandbox", () =>
      PayoutPartner.sandbox(Duration.seconds(8)).pipe(
        Layer.provide(walletSettingsLayer),
      ),
    ),
    Match.exhaustive,
  ),
);

const requestRateLimitsLayer = Layer.suspend(() =>
  rateLimitsLayer({
    principal: env.WALLET_RATE_LIMITER,
    client: env.PUBLIC_RATE_LIMITER,
  }),
);

const requestWalletLayer = Layer.suspend(() =>
  Wallet.layer.pipe(
    Layer.provide(payoutPartnerLayer),
    Layer.provide(walletSettingsLayer),
    Layer.provide(databaseLayer(env.HYPERDRIVE)),
    Layer.provide(workQueueLayer(env.WALLET_WORK)),
    Layer.provide(requestRateLimitsLayer),
    Layer.provide(FetchHttpClient.layer),
  ),
);

const requestPaymentRequestsLayer = Layer.suspend(() =>
  PaymentRequests.layer.pipe(
    Layer.provide(walletSettingsLayer),
    Layer.provide(databaseLayer(env.HYPERDRIVE)),
    Layer.provide(requestRateLimitsLayer),
  ),
);

const requestRequestPaymentsLayer = Layer.suspend(() =>
  RequestPayments.layer.pipe(
    Layer.provide(payoutPartnerLayer),
    Layer.provide(walletSettingsLayer),
    Layer.provide(databaseLayer(env.HYPERDRIVE)),
    Layer.provide(workQueueLayer(env.WALLET_WORK)),
    Layer.provide(requestRateLimitsLayer),
    Layer.provide(FetchHttpClient.layer),
  ),
);

const concealedWith =
  <S, LE>(layer: Layer.Layer<S, LE>) =>
  <A, E>(program: Effect.Effect<A, E, S>) =>
    program.pipe(Effect.provide(layer), Effect.catchCause(concealFailure));

export function runWallet<A>(
  program: Effect.Effect<A, ServerFailure, Wallet>,
): Promise<A> {
  return Effect.runPromise(concealedWith(requestWalletLayer)(program));
}

const sessionCookieFor = (url: URL) =>
  url.protocol === "https:"
    ? ({ name: "__Host-orchid-session", secure: true } as const)
    : ({ name: "orchid-session", secure: false } as const);

const grantCookie = (grant: SessionGrant, now: number) => {
  const { name, secure } = sessionCookieFor(getRequestUrl());

  setCookie(name, grant.token, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: Math.max(0, Math.floor((grant.expiresAt - now) / 1000)),
  });
};

const answeringWith = <S, LE>(layer: Layer.Layer<S | Principal, LE>) => {
  const concealed = concealedWith(layer);

  const answered = <A, I, E>(
    step: Schema.Codec<A, I>,
    program: Effect.Effect<A, E, S | Principal>,
  ) =>
    concealed(
      program.pipe(
        Effect.flatMap((answer) =>
          Effect.all({
            encoded: Schema.encodeEffect(step)(answer),
            grant: Principal.use((principal) => principal.issued),
            now: Clock.currentTimeMillis,
          }),
        ),
      ),
    ).pipe(Effect.result);

  return async <C, D, A, I, E>(
    call: Schema.Codec<C, D>,
    data: D,
    step: Schema.Codec<A, I>,
    program: (decoded: C) => Effect.Effect<A, E, S | Principal>,
  ): Promise<I | typeof ServerFailure.Encoded> => {
    const cookie = getCookie(sessionCookieFor(getRequestUrl()).name);
    const clientAddress = getRequestHeader("cf-connecting-ip");

    const outcome = await Effect.runPromise(
      answered(
        step,
        Schema.decodeEffect(call)(data).pipe(Effect.flatMap(program)),
      ).pipe(
        Effect.provideService(SessionCookie, Option.fromNullishOr(cookie)),
        Effect.provideService(
          ClientAddress,
          Option.fromNullishOr(clientAddress),
        ),
      ),
    );

    return Result.match(outcome, {
      onFailure: (failure) => Schema.encodeSync(ServerFailure)(failure),
      onSuccess: ({ encoded, grant, now }) => {
        if (Option.isSome(grant)) grantCookie(grant.value, now);

        return encoded;
      },
    });
  };
};

export const answerWallet = answeringWith(requestWalletLayer);

export const answerPaymentRequests = answeringWith(requestPaymentRequestsLayer);

export const answerRequestPayments = answeringWith(requestRequestPaymentsLayer);

export const speakingFor = <A, E, R>(
  address: AccountAddress,
  program: Effect.Effect<A, E, R>,
) =>
  Principal.use((principal) => principal.speaksFor(address)).pipe(
    Effect.andThen(program),
  );

export const publicly = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  Principal.use((principal) => principal.admitsPublicCall).pipe(
    Effect.andThen(program),
  );
