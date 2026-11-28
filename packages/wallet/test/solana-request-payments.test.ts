import { expect, it } from "@effect/vitest";
import {
  address,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";
import { USDC_MINT_ADDRESS } from "@workspace/orchid-links";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import { PaymentRequestId, PositiveAmount } from "../src/contract";
import type { ExternalPaymentTerms } from "../src/server/chain-request-payments.server";
import {
  Expired,
  Rejected,
  type Settlement,
  Undecided,
} from "../src/server/chain-settlement.server";
import { usdcAccountOf } from "../src/solana/program-addresses";
import { solanaRequestPayments } from "../src/solana/request-payments.server";
import { solanaRpc } from "../src/solana/rpc.server";
import { decodeWireTransaction } from "../src/solana/wire-transaction";
import { bodyText, httpClientAnswering, jsonResponse } from "./http-answering";
import { addressOf, randomKey } from "./test-keys";

const terms: ExternalPaymentTerms = {
  payer: addressOf(randomKey()),
  requester: addressOf(randomKey()),
  amount: Schema.decodeSync(PositiveAmount)("2000000"),
  request: Schema.decodeSync(PaymentRequestId)("aaaaaaaaa1"),
};

const draftedSlot = 5_000;

const lastValidBlockHeight = 1_000;

const RpcRequest = Schema.fromJsonString(
  Schema.Struct({ method: Schema.String }),
);

type Landing =
  | {
      readonly kind: "ours";
      readonly err: Schema.Json;
      readonly balances: boolean;
    }
  | { readonly kind: "other" }
  | { readonly kind: "missing" };

interface Node {
  readonly landing?: Landing;
  readonly pastWindow?: boolean;
  readonly firstAvailableBlock?: number;
  readonly lagging?: boolean;
}

const creditedIndex = (transaction: string) =>
  getCompiledTransactionMessageDecoder()
    .decode(
      decodeWireTransaction(getBase64Encoder().encode(transaction))
        .messageBytes,
    )
    .staticAccounts.indexOf(usdcAccountOf(address(terms.requester)));

const usdcAt = (accountIndex: number, amount: string) => ({
  accountIndex,
  mint: USDC_MINT_ADDRESS,
  uiTokenAmount: { amount },
});

const SignatureLookup = Schema.fromJsonString(
  Schema.Struct({
    method: Schema.Literal("getSignaturesForAddress"),
    params: Schema.Tuple([
      Schema.String,
      Schema.Struct({ minContextSlot: Schema.Int }),
    ]),
  }),
);

const minContextSlotNotReached = {
  code: -32016,
  message: "Minimum context slot has not been reached",
};

const replying = (
  results: Readonly<Record<string, () => Schema.Json>>,
  lagging = false,
) =>
  httpClientAnswering((request) => {
    const body = bodyText(request);
    const { method } = Schema.decodeSync(RpcRequest)(body);

    const refused =
      lagging &&
      Option.exists(
        Schema.decodeOption(SignatureLookup)(body),
        ({ params: [, options] }) => options.minContextSlot > 0,
      );

    return Effect.succeed(
      jsonResponse(
        JSON.stringify(
          refused
            ? { jsonrpc: "2.0", id: 1, error: minContextSlotNotReached }
            : { jsonrpc: "2.0", id: 1, result: results[method]?.() ?? null },
        ),
      ),
    );
  });

const requestPaymentsOn = (client: HttpClient.HttpClient) =>
  solanaRequestPayments(
    solanaRpc(client, "https://rpc.test", Duration.seconds(5)),
  );

const settlementOn = ({
  landing,
  pastWindow = true,
  firstAvailableBlock = 0,
  lagging = false,
}: Node) =>
  Effect.gen(function* () {
    const drafting = requestPaymentsOn(yield* HttpClient.HttpClient);

    const payment = yield* drafting.draftExternalPayment(terms);
    const other = yield* drafting.draftExternalPayment(terms);

    const landed = (): Schema.Json => {
      if (landing === undefined || landing.kind === "missing") return null;

      if (landing.kind === "other")
        return {
          blockTime: 1_795_149_020,
          transaction: [other.transaction, "base64"],
          meta: {
            err: null,
            preTokenBalances: [usdcAt(creditedIndex(other.transaction), "0")],
            postTokenBalances: [
              usdcAt(creditedIndex(other.transaction), "2000000"),
            ],
          },
        };

      const credited = creditedIndex(payment.transaction);

      return {
        blockTime: 1_795_149_020,
        transaction: [payment.transaction, "base64"],
        meta: landing.balances
          ? {
              err: landing.err,
              preTokenBalances: [usdcAt(credited, "0")],
              postTokenBalances: [usdcAt(credited, "2000000")],
            }
          : { err: landing.err },
      };
    };

    const answering = replying(
      {
        getSignaturesForAddress: () =>
          landing === undefined
            ? []
            : [{ signature: "landed-signature", slot: draftedSlot + 10 }],
        getTransaction: landed,
        getEpochInfo: () => ({
          absoluteSlot: 6_000,
          blockHeight: lastValidBlockHeight + (pastWindow ? 1 : 0),
        }),
        getFirstAvailableBlock: () => firstAvailableBlock,
      },
      lagging,
    );

    const node = requestPaymentsOn(
      yield* HttpClient.HttpClient.pipe(Effect.provide(answering)),
    );

    return yield* node.externalPaymentSettlement(payment, terms);
  }).pipe(
    Effect.provide(
      replying({
        getLatestBlockhash: () => ({
          context: { slot: draftedSlot },
          value: {
            blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
            lastValidBlockHeight,
          },
        }),
        getRecentPrioritizationFees: () => [],
      }),
    ),
  );

const cases: ReadonlyArray<Node & { name: string; outcome: Settlement }> = [
  {
    name: "rejects its own transaction that landed with an error",
    landing: {
      kind: "ours",
      err: { InstructionError: [2, { Custom: 1 }] },
      balances: true,
    },
    outcome: new Rejected({ code: "InstructionError" }),
  },
  {
    name: "expires past a transaction that pays the requester without the reference's signature",
    landing: { kind: "other" },
    outcome: new Expired(),
  },
  {
    name: "waits for a listed transaction the node cannot return yet",
    landing: { kind: "missing" },
    outcome: new Undecided(),
  },
  {
    name: "waits for its own transaction landed without token balances",
    landing: { kind: "ours", err: null, balances: false },
    outcome: new Undecided(),
  },
  {
    name: "never expires when history is pruned past the drafted slot",
    firstAvailableBlock: draftedSlot + 1,
    outcome: new Undecided(),
  },
  {
    name: "never expires on a node that has not reached the finalized slot",
    lagging: true,
    outcome: new Undecided(),
  },
];

it.effect.each(cases)("$name", ({ outcome, ...node }) =>
  Effect.gen(function* () {
    expect(yield* settlementOn(node)).toEqual(outcome);
  }),
);
