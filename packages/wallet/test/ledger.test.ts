import { expect, it } from "@effect/vitest";
import { Account, Keypair, xdr } from "@stellar/stellar-sdk";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import {
  AccountAddress,
  Approval,
  PositiveAmount,
  SigningRequest,
  baseAsset,
} from "../src/contract";
import {
  ApprovalInvalid,
  Chain,
  SubmissionRejected,
} from "../src/server/Chain.server";
import { ChainUnreachable } from "../src/server/chain-errors.server";
import { holdingsFromEntries } from "../src/stellar/ledger-assets.server";
import { draftPayment, signingPayload } from "../src/stellar/envelopes";
import { usdc } from "../src/stellar/network";
import {
  accountEntryXdr,
  chainWithHttp,
  httpClientAnswering,
  jsonResponse,
  rpcAnswering,
  rpcOk,
  submittedTransaction,
} from "./rpc-answering";

const holder = Keypair.random();
const address = Schema.decodeSync(AccountAddress)(holder.publicKey());

const recipient = Schema.decodeSync(AccountAddress)(
  Keypair.random().publicKey(),
);

const chainSubmitting = (reply: (tx: string) => string) =>
  chainWithHttp(
    httpClientAnswering((req) =>
      Effect.succeed(jsonResponse(reply(submittedTransaction(req)))),
    ),
  );

const sealedPayment = Effect.gen(function* () {
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);

  const envelope = draftPayment({
    asset: baseAsset,
    source: new Account(address, "123"),
    to: recipient,
    amount: Schema.decodeSync(PositiveAmount)("1"),
    minTime: now,
    maxTime: now + 120,
  });

  return yield* Chain.use((c) =>
    c.seal(
      new SigningRequest({
        envelope,
        expiresAt: DateTime.makeUnsafe((now + 120) * 1000),
      }),
      new Approval({ signature: holder.sign(signingPayload(envelope)) }),
      address,
    ),
  ).pipe(Effect.provide(chainSubmitting(() => "")));
});

const txBadSeqXdr = new xdr.TransactionResult({
  feeCharged: 100n,
  result: xdr.TransactionResultResult.txBadSeq(),
  ext: xdr.TransactionResultExt.v0(),
}).toXDR("base64");

const feeBumpTooEarlyXdr = new xdr.TransactionResult({
  feeCharged: 200n,
  result: xdr.TransactionResultResult.txFeeBumpInnerFailed(
    new xdr.InnerTransactionResultPair({
      transactionHash: new Uint8Array(32),
      result: new xdr.InnerTransactionResult({
        feeCharged: 100n,
        result: xdr.InnerTransactionResultResult.txTooEarly(),
        ext: xdr.TransactionResultExt.v0(),
      }),
    }),
  ),
  ext: xdr.TransactionResultExt.v0(),
}).toXDR("base64");

it.effect("fails with ChainUnreachable on a non-OK HTTP status", () =>
  Effect.gen(function* () {
    const http = httpClientAnswering(() =>
      Effect.succeed(new Response("bad gateway", { status: 502 })),
    );

    expect(
      yield* Chain.use((c) => c.balance(address)).pipe(
        Effect.provide(chainWithHttp(http)),
        Effect.flip,
      ),
    ).toBeInstanceOf(ChainUnreachable);
  }),
);

it.effect.each(["PENDING", "DUPLICATE"])(
  "submit accepts sendTransaction status %s",
  (status) =>
    Effect.gen(function* () {
      const sealed = yield* sealedPayment;
      let submitted: string | undefined;

      yield* Chain.use((c) => c.submit(sealed)).pipe(
        Effect.provide(
          chainSubmitting((tx) => {
            submitted = tx;

            return rpcOk({ status, hash: sealed.hash, latestLedger: 100 });
          }),
        ),
      );
      expect(submitted).toBe(sealed.envelope);
    }),
);

it.effect.each([
  [
    "TRY_AGAIN_LATER",
    { status: "TRY_AGAIN_LATER" },
    "ChainUnreachable",
    undefined,
  ],
  [
    "ERROR with a direct transaction result",
    { status: "ERROR", errorResultXdr: txBadSeqXdr },
    "SubmissionRejected",
    "txBadSeq",
  ],
  [
    "ERROR with a fee-bump inner transaction result",
    { status: "ERROR", errorResultXdr: feeBumpTooEarlyXdr },
    "SubmissionRejected",
    "txTooEarly",
  ],
] as const)("submit rejects %s", ([, result, tag, code]) =>
  Effect.gen(function* () {
    const sealed = yield* sealedPayment;

    const failure = yield* Chain.use((c) => c.submit(sealed)).pipe(
      Effect.provide(chainSubmitting(() => rpcOk(result))),
      Effect.flip,
    );

    expect(failure._tag).toBe(tag);
    expect(
      failure instanceof SubmissionRejected ? failure.code : undefined,
    ).toBe(code);
  }),
);

it.effect(
  "seal rejects a once-valid approval after Effect Clock enters the margin",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_700_000_000_000);

      const chainLayer = chainWithHttp(
        rpcAnswering(() =>
          rpcOk({
            entries: [{ xdr: accountEntryXdr(holder, 123n) }],
            latestLedger: 7,
          }),
        ),
      );

      const draft = yield* Chain.use((c) =>
        c.draftPayment(
          address,
          recipient,
          baseAsset,
          Schema.decodeSync(PositiveAmount)("1"),
        ),
      ).pipe(Effect.provide(chainLayer));

      const approval = new Approval({
        signature: holder.sign(signingPayload(draft.envelope)),
      });

      yield* Chain.use((c) => c.seal(draft, approval, address)).pipe(
        Effect.provide(chainLayer),
      );
      yield* TestClock.adjust("101 seconds");
      expect(
        yield* Chain.use((c) => c.seal(draft, approval, address)).pipe(
          Effect.provide(chainLayer),
          Effect.flip,
        ),
      ).toBeInstanceOf(ApprovalInvalid);
    }),
);

it("incoming capacity of a trustline subtracts its balance and buying liabilities", () => {
  const key = Keypair.random();

  const line = xdr.LedgerEntryData.trustline(
    new xdr.TrustLineEntry({
      accountId: key.xdrPublicKey(),
      asset: usdc.toTrustLineXdrObject(),
      balance: 300n,
      limit: 1_000n,
      flags: 1,
      ext: xdr.TrustLineEntryExt.v1(
        new xdr.TrustLineEntryV1({
          liabilities: new xdr.Liabilities({ buying: 90n, selling: 0n }),
          ext: xdr.TrustLineEntryV1Ext.v0(),
        }),
      ),
    }),
  ).toXDR("base64");

  const holdings = holdingsFromEntries(
    [{ xdr: accountEntryXdr(key, 1n, 1) }, { xdr: line }],
    Keypair.random().publicKey(),
    Schema.decodeSync(AccountAddress)(key.publicKey()),
    [baseAsset],
  );

  expect(
    Option.getOrThrow(holdings).lines.map((entry) => entry.capacity),
  ).toEqual([610n]);
});
