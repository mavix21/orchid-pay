import { StrKey, xdr } from "@stellar/stellar-sdk";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { AccountAddress, Amount } from "../contract";
import { ChainUnreachable } from "../server/chain-errors.server";

export const LedgerEntry = Schema.Struct({
  xdr: Schema.String,
  extXdr: Schema.optional(Schema.String),
});

export type LedgerEntry = typeof LedgerEntry.Type;

const LedgerResult = Schema.Struct({
  entries: Schema.optional(Schema.Array(LedgerEntry)),
  latestLedger: Schema.Number,
});

export type LedgerResult = typeof LedgerResult.Type;

export interface AccountState {
  readonly sequence: string;
  readonly nativeBalance: bigint;
  readonly balance: Option.Option<Amount>;
  readonly ledger: number;
  readonly accountSponsored: boolean;
  readonly sponsored: boolean;
  readonly untouched: boolean;
}

export type RpcValue =
  | string
  | number
  | ReadonlyArray<RpcValue>
  | { readonly [key: string]: RpcValue };

export type RpcParams = Readonly<Record<string, RpcValue>>;

export interface StellarRpc {
  call<A, I>(
    method: string,
    params: RpcParams,
    result: Schema.Codec<A, I>,
  ): Effect.Effect<A, ChainUnreachable>;
  entries(
    keys: ReadonlyArray<xdr.LedgerKey>,
  ): Effect.Effect<LedgerResult, ChainUnreachable>;
}

const rpcReply = <A, I>(result: Schema.Codec<A, I>) =>
  Schema.fromJsonString(
    Schema.Union([
      Schema.Struct({ result }),
      Schema.Struct({
        error: Schema.Struct({ code: Schema.Number, message: Schema.String }),
      }),
    ]),
  );

export const stellarRpc = (
  client: HttpClient.HttpClient,
  rpcUrl: string,
  deadline: Duration.Duration,
): StellarRpc => {
  const call = <A, I>(
    method: string,
    params: RpcParams,
    result: Schema.Codec<A, I>,
  ): Effect.Effect<A, ChainUnreachable> =>
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
      );

      const reply = Schema.decodeSync(rpcReply(result))(text);

      return "result" in reply
        ? reply.result
        : yield* new ChainUnreachable({
            cause: new Error(reply.error.message),
          });
    }).pipe(
      Effect.timeoutOrElse({
        duration: deadline,
        orElse: () =>
          Effect.fail(
            new ChainUnreachable({
              cause: new Cause.TimeoutError(
                `Stellar RPC ${method} timed out after ${Duration.format(deadline)}`,
              ),
            }),
          ),
      }),
    );

  return {
    call,
    entries: (keys) =>
      call(
        "getLedgerEntries",
        { keys: [...new Set(keys.map((key) => key.toXdr("base64")))] },
        LedgerResult,
      ),
  };
};

export function sponsorOf(entry: LedgerEntry): Option.Option<AccountAddress> {
  if (!entry.extXdr) return Option.none();

  const extension = xdr.LedgerEntryExt.fromXDR(entry.extXdr, "base64");

  return extension.type === "v1" && extension.v1.sponsoringId !== null
    ? Schema.decodeOption(AccountAddress)(
        StrKey.encodeEd25519PublicKey(
          extension.v1.sponsoringId.ed25519.toBytes(),
        ),
      )
    : Option.none();
}

export function sponsoredBy(entry: LedgerEntry, sponsor: string): boolean {
  return Option.exists(sponsorOf(entry), (address) => address === sponsor);
}

const untouchedThresholds = [1, 0, 0, 0];

function isUntouched(account: xdr.AccountEntry): boolean {
  const v1 = account.ext.type === "v1" ? account.ext.v1 : undefined;
  const v2 = v1?.ext.type === "v2" ? v1.ext.v2 : undefined;

  return (
    account.numSubEntries === 0 &&
    account.signers.length === 0 &&
    account.flags === 0 &&
    (v2?.numSponsoring ?? 0) === 0 &&
    untouchedThresholds.every(
      (weight, index) => account.thresholds.value[index] === weight,
    )
  );
}

export function accountFromEntries(
  entries: ReadonlyArray<LedgerEntry>,
  ledger: number,
  sponsor: string,
): Option.Option<AccountState> {
  const parsed = entries.map((entry) => ({
    value: xdr.LedgerEntryData.fromXDR(entry.xdr, "base64"),
    sponsored: sponsoredBy(entry, sponsor),
  }));

  const account = parsed.find((entry) => entry.value.type === "account");
  const trust = parsed.find((entry) => entry.value.type === "trustline");

  if (!account || account.value.type !== "account") return Option.none();

  return Option.some({
    sequence: account.value.value.seqNum.toString(),
    nativeBalance: account.value.value.balance,
    balance:
      trust?.value.type === "trustline"
        ? Option.some(
            Schema.decodeSync(Amount)(trust.value.value.balance.toString()),
          )
        : Option.none(),
    ledger,
    accountSponsored: account.sponsored,
    sponsored: account.sponsored && trust?.sponsored === true,
    untouched: isUntouched(account.value.value),
  });
}
