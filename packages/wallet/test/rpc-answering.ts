import { Keypair, xdr } from "@stellar/stellar-sdk";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import { Chain } from "../src/server/Chain.server";
import { WalletSettings } from "../src/server/settings.server";
import { bodyText, httpClientAnswering, jsonResponse } from "./http-answering";
import { dbLayer } from "./test-database";

export { bodyText, httpClientAnswering, jsonResponse };

const MethodReq = Schema.fromJsonString(
  Schema.Struct({ method: Schema.String }),
);

const KeysReq = Schema.fromJsonString(
  Schema.Struct({
    method: Schema.Literal("getLedgerEntries"),
    params: Schema.Struct({ keys: Schema.Array(Schema.String) }),
  }),
);

const TxReq = Schema.fromJsonString(
  Schema.Struct({
    method: Schema.Literal("getTransaction"),
    params: Schema.Struct({ hash: Schema.String }),
  }),
);

const SubmitReq = Schema.fromJsonString(
  Schema.Struct({
    method: Schema.Literal("sendTransaction"),
    params: Schema.Struct({ transaction: Schema.String }),
  }),
);

export const testRpcUrl = "https://rpc.test";

export const rpcError = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  error: { code: -32603, message: "could not query captive core" },
});

export const rpcOk = <A>(result: A) =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, result });

export const rpcMethod = (req: HttpClientRequest.HttpClientRequest) =>
  Schema.decodeSync(MethodReq)(bodyText(req)).method;

const ledgerKeys = (req: HttpClientRequest.HttpClientRequest) =>
  Schema.decodeSync(KeysReq)(bodyText(req)).params.keys;

export const submittedTransaction = (
  req: HttpClientRequest.HttpClientRequest,
) => Schema.decodeSync(SubmitReq)(bodyText(req)).params.transaction;

export const queriedHash = (req: HttpClientRequest.HttpClientRequest) =>
  Schema.decodeSync(TxReq)(bodyText(req)).params.hash;

export const rpcAnswering = (reply: (keys: ReadonlyArray<string>) => string) =>
  httpClientAnswering((req) =>
    Effect.succeed(jsonResponse(reply(ledgerKeys(req)))),
  );

export const accountEntryXdr = (
  key: Keypair,
  seqNum: bigint,
  numSubEntries = 0,
) =>
  xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId: key.xdrAccountId(),
      balance: 0n,
      seqNum,
      numSubEntries,
      inflationDest: null,
      flags: 0,
      homeDomain: "",
      thresholds: new Uint8Array([1, 0, 0, 0]),
      signers: [],
      ext: xdr.AccountEntryExt.v0(),
    }),
  ).toXDR("base64");

export const chainWithHttp = (
  http: Layer.Layer<HttpClient.HttpClient>,
  options: {
    readonly rpcUrl?: string;
    readonly rpcTimeout?: Duration.Input;
    readonly sponsor?: Keypair;
    readonly feePayer?: Keypair;
  } = {},
) => {
  const sponsor = options.sponsor ?? Keypair.random();
  const feePayer = options.feePayer ?? Keypair.random();
  const passkeyOrigins: ReadonlyArray<string> = [];

  const base = {
    rpcUrl: options.rpcUrl ?? testRpcUrl,
    reserveSponsorSecret: Redacted.make(sponsor.secret()),
    feePayerSecret: Redacted.make(feePayer.secret()),
    passkeyOrigins,
    humanCheckSecret: Redacted.make("human-check-secret"),
    sessionSecret: Redacted.make("session-secret"),
  };

  const cfg = Layer.succeed(
    WalletSettings,
    options.rpcTimeout !== undefined
      ? { ...base, rpcTimeout: options.rpcTimeout }
      : base,
  );

  return Chain.layer.pipe(
    Layer.provide(cfg),
    Layer.provide(http),
    Layer.provide(dbLayer),
  );
};

export const testnetReply = (method: string) =>
  Match.value(method).pipe(
    Match.when("getTransaction", () =>
      rpcOk({
        latestLedger: 5825076,
        latestLedgerCloseTime: "1795149020",
        oldestLedger: 5704117,
        oldestLedgerCloseTime: "1794544229",
        status: "NOT_FOUND",
        applicationOrder: 0,
        feeBump: false,
        events: {},
        ledger: 0,
        createdAt: "0",
      }),
    ),
    Match.when("getLedgerEntries", () =>
      rpcOk({ entries: [], latestLedger: 5825076 }),
    ),
    Match.orElse(() => rpcError),
  );
