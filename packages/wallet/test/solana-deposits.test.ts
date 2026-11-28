import { expect, it } from "@effect/vitest";
import { address } from "@solana/kit";
import { USDC_MINT_ADDRESS } from "@workspace/orchid-links";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import type { DepositPage } from "../src/server/chain-deposits.server";
import { signaturesPerRequest } from "../src/solana/address-history.server";
import { solanaDepositChain } from "../src/solana/deposit-chain.server";
import { usdcAccountOf } from "../src/solana/program-addresses";
import { solanaRpc } from "../src/solana/rpc.server";
import { solanaUnclaimedFunds } from "../src/solana/unclaimed-funds.server";
import { assertTagged } from "./tagged";
import { bodyText, httpClientAnswering, jsonResponse } from "./http-answering";
import { randomAddress, randomUnclaimedFundsId } from "./test-keys";

const RpcRequest = Schema.fromJsonString(
  Schema.Union([
    Schema.Struct({
      method: Schema.Literal("getSignaturesForAddress"),
      params: Schema.Tuple([
        Schema.String,
        Schema.Struct({
          commitment: Schema.Literal("finalized"),
          limit: Schema.Int,
          before: Schema.optional(Schema.String),
          until: Schema.optional(Schema.String),
        }),
      ]),
    }),
    Schema.Struct({
      method: Schema.Literal("getTransaction"),
      params: Schema.Tuple([
        Schema.String,
        Schema.Struct({
          commitment: Schema.Literal("finalized"),
          encoding: Schema.Literal("jsonParsed"),
          maxSupportedTransactionVersion: Schema.Literal(1),
        }),
      ]),
    }),
  ]),
);

interface Signature {
  readonly signature: string;
  readonly slot: number;
  readonly err: Schema.Json;
  readonly blockTime: number;
}

const wallet = randomAddress();
const usdcAccount = usdcAccountOf(address(wallet));

const signed = (slot: number, err: Schema.Json = null): Signature => ({
  signature: `signature-${slot}`,
  slot,
  err,
  blockTime: 1_795_000_000 + slot,
});

const usdc = (index: number, owner: string | null, amount: bigint) => ({
  accountIndex: index,
  mint: USDC_MINT_ADDRESS,
  owner,
  uiTokenAmount: { amount: amount.toString() },
});

const transferInto = (slot: number, sender: string, amount: bigint) => ({
  slot,
  blockTime: 1_795_000_000 + slot,
  transaction: {
    message: {
      accountKeys: [
        { pubkey: sender },
        { pubkey: randomAddress() },
        { pubkey: usdcAccount },
        { pubkey: randomAddress() },
      ],
    },
  },
  meta: {
    err: null,
    preTokenBalances: [
      usdc(1, sender, amount),
      usdc(2, wallet, 0n),
      usdc(3, null, 7n),
    ],
    postTokenBalances: [
      usdc(1, sender, 0n),
      usdc(2, wallet, amount),
      usdc(3, null, 7n),
    ],
  },
});

interface Node {
  readonly history: ReadonlyArray<Signature>;
  readonly transactions: ReadonlyMap<string, Schema.Json>;
}

const answer = (
  history: Node["history"],
  transactions: Node["transactions"],
  call: typeof RpcRequest.Type,
): Schema.Json | ReadonlyArray<Signature> => {
  if (call.method === "getTransaction")
    return transactions.get(call.params[0]) ?? null;

  const [, { before, until, limit }] = call.params;
  const newestFirst = Arr.reverse(history);
  const end = newestFirst.findIndex((entry) => entry.signature === until);
  const start = newestFirst.findIndex((entry) => entry.signature === before);

  return newestFirst
    .slice(start + 1, end < 0 ? undefined : end)
    .slice(0, limit);
};

const rpcOf = ({ history, transactions }: Node) =>
  Effect.map(HttpClient.HttpClient, (client) =>
    solanaRpc(client, "https://rpc.test", Duration.seconds(5)),
  ).pipe(
    Effect.provide(
      httpClientAnswering((request) => {
        const call = Schema.decodeSync(RpcRequest)(bodyText(request));

        const result = answer(history, transactions, call);

        return Effect.succeed(
          jsonResponse(JSON.stringify({ jsonrpc: "2.0", id: 1, result })),
        );
      }),
    ),
  );

const sender = randomAddress();
const oldest = signed(10);
const newest = signed(signaturesPerRequest + 20);

const failedBetween = Array.from({ length: signaturesPerRequest }, (_, index) =>
  signed(11 + index, { InstructionError: [0, "Custom"] }),
);

const vaultClaim = signed(signaturesPerRequest + 15);

const history = [oldest, ...failedBetween, vaultClaim, newest];

const transactions = new Map<string, Schema.Json>([
  [oldest.signature, transferInto(oldest.slot, sender, 1_000_000n)],
  [
    vaultClaim.signature,
    transferInto(vaultClaim.slot, randomUnclaimedFundsId(), 3_000_000n),
  ],
  [newest.signature, transferInto(newest.slot, sender, 2_000_000n)],
]);

const depositsOf = (pages: ReadonlyArray<DepositPage>) =>
  pages.flatMap((page) => page.deposits.map(({ amount }) => amount));

it.effect(
  "reads deposits oldest first across signature pages, skips failed transactions and a claim out of an off-curve vault, and resumes after the stored position",
  () =>
    Effect.gen(function* () {
      const chain = solanaDepositChain(yield* rpcOf({ history, transactions }));

      const pages = yield* Stream.runCollect(
        chain.depositsInto(wallet, Option.none()),
      );

      expect(depositsOf(pages)).toEqual([1_000_000n, 2_000_000n]);
      expect(pages.at(-1)?.position).toEqual({
        cursor: newest.signature,
        ledger: newest.slot,
      });

      const resumed = yield* Stream.runCollect(
        chain.depositsInto(
          wallet,
          Option.some({ cursor: oldest.signature, ledger: oldest.slot }),
        ),
      );

      expect(depositsOf(resumed)).toEqual([2_000_000n]);
    }),
);

it.effect("stops before a listed transaction that RPC cannot return yet", () =>
  Effect.gen(function* () {
    const chain = solanaDepositChain(
      yield* rpcOf({
        history,
        transactions: new Map([...transactions].slice(0, 1)),
      }),
    );

    const stored: Array<DepositPage> = [];

    const failure = yield* chain.depositsInto(wallet, Option.none()).pipe(
      Stream.runForEach((page) => Effect.sync(() => stored.push(page))),
      Effect.flip,
    );

    assertTagged(failure, "ChainUnreachable");
    expect(depositsOf(stored)).toEqual([1_000_000n]);
    expect(stored.map((page) => page.position.cursor)).not.toContain(
      newest.signature,
    );
  }),
);

it.effect(
  "dates closed unclaimed funds by their newest successful signature",
  () =>
    Effect.gen(function* () {
      const closing = signed(40);
      const failedLater = signed(50, "AccountNotFound");

      const { unclaimedFundsClosedAt } = solanaUnclaimedFunds(
        yield* rpcOf({
          history: [signed(30), closing, failedLater],
          transactions: new Map(),
        }),
        randomAddress(),
      );

      expect(yield* unclaimedFundsClosedAt(randomUnclaimedFundsId())).toEqual(
        Option.some(DateTime.makeUnsafe(closing.blockTime * 1000)),
      );
    }),
);
