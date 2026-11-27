import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { defaultRpcTimeout } from "./settings.server";

const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export const validateRpcUrl = (rpcUrl: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try(() => new URL(rpcUrl)).pipe(Effect.orDie);

    if (
      parsed.protocol !== "https:" &&
      !(parsed.protocol === "http:" && loopbackHosts.has(parsed.hostname))
    )
      return yield* Effect.die(
        new Error("RPC URL must use HTTPS unless targeting a loopback host"),
      );

    return rpcUrl;
  });

export const validateRpcTimeout = (
  input: Duration.Input | undefined,
): Effect.Effect<Duration.Duration> => {
  if (input === undefined) return Effect.succeed(defaultRpcTimeout);

  const parsed = Duration.fromInput(input);

  if (
    Option.isSome(parsed) &&
    Duration.isFinite(parsed.value) &&
    Duration.isPositive(parsed.value)
  )
    return Effect.succeed(parsed.value);

  return Effect.die(
    new Error("RPC timeout must be a positive finite duration"),
  );
};
