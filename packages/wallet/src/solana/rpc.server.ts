import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as UrlParams from "effect/http/UrlParams";
import { ChainUnreachable } from "../server/chain-errors.server";

export type RpcValue =
  | string
  | number
  | boolean
  | ReadonlyArray<RpcValue>
  | { readonly [key: string]: RpcValue };

export class RpcRefusal extends Schema.TaggedError<RpcRefusal>()("RpcRefusal", {
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(Schema.Json),
}) {}

export interface SolanaRpc {
  call<A, I>(
    method: string,
    params: ReadonlyArray<RpcValue>,
    result: Schema.Codec<A, I>,
  ): Effect.Effect<A, ChainUnreachable>;
  attempt<A, I>(
    method: string,
    params: ReadonlyArray<RpcValue>,
    result: Schema.Codec<A, I>,
  ): Effect.Effect<A, ChainUnreachable | RpcRefusal>;
}

const rpcKeyParameter = /^api[-_]?key$/i;

export const readCommitment = "finalized";

export const preflightCommitment = "confirmed";

export const inContext = <A, I>(value: Schema.Codec<A, I>) =>
  Schema.Struct({
    context: Schema.Struct({ slot: Schema.Int }),
    value,
  });

export const RawAccount = Schema.Struct({
  owner: Schema.String,
  data: Schema.Tuple([Schema.String, Schema.Literal("base64")]),
});

export type RawAccount = typeof RawAccount.Type;

const rpcReply = <A, I>(result: Schema.Codec<A, I>) =>
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ result }),
      Schema.Struct({
        error: Schema.Struct({
          code: Schema.Number,
          message: Schema.String,
          data: Schema.optional(Schema.Json),
        }),
      }),
    ]),
  );

export const solanaRpc = (
  client: HttpClient.HttpClient,
  rpcUrl: string,
  deadline: Duration.Duration,
): SolanaRpc => {
  const attempt = <A, I>(
    method: string,
    params: ReadonlyArray<RpcValue>,
    result: Schema.Codec<A, I>,
  ) =>
    Effect.gen(function* () {
      const request = yield* HttpClientRequest.post(rpcUrl).pipe(
        HttpClientRequest.bodyJson({ jsonrpc: "2.0", id: 1, method, params }),
        Effect.orDie,
      );

      const text = yield* client.execute(request).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.text),
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.mapError((cause) => new ChainUnreachable({ cause })),
        Effect.updateService(UrlParams.CurrentRedactedNames, (names) => [
          ...names,
          rpcKeyParameter,
        ]),
      );

      const reply = Schema.decodeSync(rpcReply(result))(text);

      return "result" in reply
        ? reply.result
        : yield* new RpcRefusal(reply.error);
    }).pipe(
      Effect.timeoutOrElse({
        duration: deadline,
        orElse: () =>
          Effect.fail(
            new ChainUnreachable({
              cause: new Cause.TimeoutError(
                `Solana RPC ${method} timed out after ${Duration.format(deadline)}`,
              ),
            }),
          ),
      }),
    );

  return {
    attempt,
    call: (method, params, result) =>
      attempt(method, params, result).pipe(
        Effect.catchTag("RpcRefusal", (refusal) =>
          Effect.fail(new ChainUnreachable({ cause: refusal })),
        ),
      ),
  };
};
