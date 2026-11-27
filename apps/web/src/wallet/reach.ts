import type { CustomFetch } from "@tanstack/react-start";
import {
  InvalidResponse,
  Offline,
  ServerFailure,
  ServerUnreachable,
  unreachedServer,
} from "@workspace/wallet";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

export const accepted =
  <D>() =>
  (data: D) =>
    data;

const reachingFetch: CustomFetch = (input, init) =>
  fetch(input, init).catch(() => Promise.reject(unreachedServer()));

const isServerFailure = Schema.is(ServerFailure);

export const reach = <A, I, C, D, R>(
  step: Schema.Codec<A, I>,
  call: Schema.Codec<C, D>,
  request: C,
  serverFn: (options: {
    data: D;
    fetch: CustomFetch;
    signal: AbortSignal;
  }) => Promise<R>,
) =>
  Schema.encodeEffect(call)(request).pipe(
    Effect.orDie,
    Effect.flatMap((data) =>
      Effect.tryPromise({
        try: (signal) => serverFn({ data, fetch: reachingFetch, signal }),
        catch: (cause) =>
          Predicate.isTagged(cause, "Offline")
            ? new Offline()
            : Predicate.isTagged(cause, "ServerUnreachable")
              ? new ServerUnreachable()
              : new InvalidResponse(),
      }),
    ),
    Effect.flatMap((answer) =>
      Schema.decodeUnknownEffect(Schema.Union([step, ServerFailure]))(
        answer,
      ).pipe(Effect.mapError(() => new InvalidResponse())),
    ),
    Effect.flatMap((answer) =>
      isServerFailure(answer) ? Effect.fail(answer) : Effect.succeed(answer),
    ),
  );
