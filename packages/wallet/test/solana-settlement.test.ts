import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import {
  Applied,
  Expired,
  Rejected,
  type Settlement,
  Undecided,
} from "../src/server/chain-settlement.server";
import { solanaRpc } from "../src/solana/rpc.server";
import { resolveSettlement } from "../src/solana/settlement.server";
import { bodyText, httpClientAnswering, jsonResponse } from "./http-answering";

const sent = {
  signature: "sent-signature",
  lastValidBlockHeight: 1_000n,
  draftedSlot: 5_000n,
};

const RpcRequest = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({
      method: Schema.Literal("getSignatureStatuses"),
      params: Schema.Tuple([
        Schema.Tuple([Schema.Literal(sent.signature)]),
        Schema.Struct({
          searchTransactionHistory: Schema.Literal(true),
          commitment: Schema.Literal("finalized"),
        }),
      ]),
    }),
    Schema.Struct({
      method: Schema.Literal("getEpochInfo"),
      params: Schema.Tuple([
        Schema.Struct({ commitment: Schema.Literal("finalized") }),
      ]),
    }),
    Schema.Struct({ method: Schema.Literal("getFirstAvailableBlock") }),
    Schema.Struct({ method: Schema.Literal("getBlockTime") }),
  ]),
);

interface SignatureReply {
  readonly slot: number;
  readonly err: Schema.Json;
  readonly confirmationStatus: "confirmed" | "finalized";
}

const landed: SignatureReply = {
  slot: 5_100,
  err: null,
  confirmationStatus: "finalized",
};

const finalizedTip = { absoluteSlot: 6_000, blockHeight: 1_001 };

const lookup = (status: SignatureReply | null, atSlot = 6_031) => ({
  context: { slot: atSlot },
  value: [status],
});

interface Node {
  readonly lookups: readonly [
    ReturnType<typeof lookup>,
    ReturnType<typeof lookup>?,
  ];
  readonly tip?: typeof finalizedTip;
  readonly firstAvailableBlock?: number;
}

const rpcOf = ({
  lookups,
  tip = finalizedTip,
  firstAvailableBlock = 0,
}: Node) => {
  const pending = [...lookups];

  return Effect.map(HttpClient.HttpClient, (client) =>
    solanaRpc(client, "https://rpc.test", Duration.seconds(5)),
  ).pipe(
    Effect.provide(
      httpClientAnswering((request) => {
        const { method } = Schema.decodeSync(RpcRequest)(bodyText(request));

        const results = {
          getSignatureStatuses: () => pending.shift(),
          getEpochInfo: () => tip,
          getFirstAvailableBlock: () => firstAvailableBlock,
          getBlockTime: () => 1_795_149_020,
        };

        return Effect.succeed(
          jsonResponse(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              result: results[method](),
            }),
          ),
        );
      }),
    ),
  );
};

const appliedAtBlockTime = new Applied({
  at: DateTime.makeUnsafe(1_795_149_020_000),
});

const cases: ReadonlyArray<Node & { name: string; outcome: Settlement }> = [
  {
    name: "applies a finalized transaction that landed without an error",
    lookups: [lookup(landed)],
    outcome: appliedAtBlockTime,
  },
  {
    name: "rejects a finalized transaction that landed with an error",
    lookups: [
      lookup({ ...landed, err: { InstructionError: [2, { Custom: 1 }] } }),
    ],
    outcome: new Rejected({ code: "InstructionError" }),
  },
  {
    name: "waits while a landed transaction can still be dropped with its fork",
    lookups: [
      lookup({
        ...landed,
        err: "AccountNotFound",
        confirmationStatus: "confirmed",
      }),
    ],
    outcome: new Undecided(),
  },
  {
    name: "waits while the finalized height is still the last valid one",
    lookups: [lookup(null), lookup(null)],
    tip: { ...finalizedTip, blockHeight: 1_000 },
    outcome: new Undecided(),
  },
  {
    name: "expires a signature missing from complete history past its blockhash",
    lookups: [lookup(null), lookup(null, 6_000)],
    firstAvailableBlock: 5_000,
    outcome: new Expired(),
  },
  {
    name: "applies a transaction that only the second lookup finds",
    lookups: [lookup(null, 5_050), lookup(landed)],
    outcome: appliedAtBlockTime,
  },
  {
    name: "never expires when history is pruned past the drafted slot",
    lookups: [lookup(null), lookup(null)],
    firstAvailableBlock: 5_001,
    outcome: new Undecided(),
  },
  {
    name: "never expires on a second lookup that lags the finalized height",
    lookups: [lookup(null), lookup(null, 5_999)],
    outcome: new Undecided(),
  },
];

it.effect.each(cases)("$name", ({ outcome, ...node }) =>
  Effect.gen(function* () {
    expect(yield* resolveSettlement(yield* rpcOf(node), sent)).toEqual(outcome);
  }),
);
