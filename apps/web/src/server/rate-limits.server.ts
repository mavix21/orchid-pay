import { RateLimits } from "@workspace/wallet/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const admits = (limiter: RateLimit, key: string) =>
  Effect.tryPromise(() => limiter.limit({ key })).pipe(
    Effect.map((outcome) => outcome.success),
    Effect.catch((cause) =>
      Effect.logWarning("Rate limiter unavailable", cause).pipe(
        Effect.as(true),
      ),
    ),
  );

export const rateLimitsLayer = (limiters: {
  readonly principal: RateLimit;
  readonly client: RateLimit;
}) =>
  Layer.succeed(RateLimits, {
    admitsPrincipal: (address) => admits(limiters.principal, address),
    admitsClient: (clientAddress) => admits(limiters.client, clientAddress),
  });
