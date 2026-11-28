import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { type RpcValue, type SolanaRpc, readCommitment } from "./rpc.server";

export const signaturesPerRequest = 1_000;

export const SignatureEntry = Schema.Struct({
  signature: Schema.String,
  slot: Schema.Int,
  err: Schema.NullOr(Schema.Json),
  blockTime: Schema.optional(Schema.NullOr(Schema.Int)),
});

export type SignatureEntry = typeof SignatureEntry.Type;

export interface HistoryWindow {
  readonly before: Option.Option<string>;
  readonly until: Option.Option<string>;
  readonly limit: number;
}

const bound = (name: string, signature: Option.Option<string>) =>
  Option.match(signature, {
    onNone: (): { readonly [key: string]: RpcValue } => ({}),
    onSome: (value) => ({ [name]: value }),
  });

export const signaturesFor = (
  rpc: SolanaRpc,
  account: string,
  window: HistoryWindow,
) =>
  rpc.call(
    "getSignaturesForAddress",
    [
      account,
      {
        commitment: readCommitment,
        limit: window.limit,
        ...bound("before", window.before),
        ...bound("until", window.until),
      },
    ],
    Schema.Array(SignatureEntry),
  );

export const blockTimeOf = (seconds: number | null | undefined) =>
  Option.fromNullishOr(seconds).pipe(
    Option.map((value) => DateTime.makeUnsafe(value * 1000)),
  );
