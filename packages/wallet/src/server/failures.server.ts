import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import {
  LedgerUnreachable,
  RateLimited,
  ServiceFailed,
  SessionRequired,
} from "../contract";

const unexpected = <E>(cause: Cause.Cause<E>) =>
  Effect.logError("Wallet request failed", Cause.pretty(cause)).pipe(
    Effect.andThen(Effect.fail(new ServiceFailed())),
  );

export const concealFailure = <E>(
  cause: Cause.Cause<E>,
): Effect.Effect<
  never,
  LedgerUnreachable | RateLimited | ServiceFailed | SessionRequired
> => {
  if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;

  const found = Cause.findError(cause);

  if (Result.isFailure(found)) return unexpected(cause);

  const failure = found.success;

  if (Predicate.isTagged(failure, "LedgerUnreachable"))
    return Effect.fail(new LedgerUnreachable());

  if (Predicate.isTagged(failure, "SessionRequired"))
    return Effect.fail(new SessionRequired());

  if (Predicate.isTagged(failure, "RateLimited"))
    return Effect.fail(new RateLimited());

  if (Predicate.isTagged(failure, "ServiceFailed"))
    return Effect.fail(new ServiceFailed());

  if (Predicate.isTagged(failure, "ChainUnreachable"))
    return Effect.logWarning("RPC unreachable", Cause.pretty(cause)).pipe(
      Effect.andThen(Effect.fail(new LedgerUnreachable())),
    );

  return unexpected(cause);
};
