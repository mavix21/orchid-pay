import { expect, it } from "@effect/vitest";
import {
  Account,
  FeeBumpTransaction,
  Keypair,
  Memo,
  Operation,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import {
  AccountAddress,
  AddressRecipient,
  Approval,
  type AssetPrecision,
  UnclaimedFundsId,
  DestinationAddress,
  PaymentMemo,
  PositiveAmount,
  SigningRequest,
  TransferOrder,
  UnsignedEnvelope,
  baseAsset,
  formatAmount,
  parseAmount,
  precisionOf,
} from "../src/contract";
import {
  Applied,
  Chain,
  Rejected,
  type SettlementReader,
  resolveSettlement,
  settlementFromResponse,
} from "../src/server/Chain.server";
import { channelKeypair } from "../src/stellar/channel-pool.server";
import {
  type AccountState,
  accountFromEntries,
} from "../src/stellar/ledger.server";
import {
  OpeningFacts,
  PaymentFacts,
  draftOpening,
  draftPayment,
  readEnvelope,
  signingPayload,
} from "../src/stellar/envelopes";
import { draftLinkReceive } from "../src/stellar/link-receive";
import { baseFee, networkPassphrase, usdc } from "../src/stellar/network";
import { accountEntryXdr, chainWithHttp } from "./rpc-answering";
import { assertTagged } from "./tagged";

const holder = Keypair.random();
const sponsor = Keypair.random();
const feePayer = Keypair.random();
const address = Schema.decodeSync(AccountAddress)(holder.publicKey());
const reserveSponsor = Schema.decodeSync(AccountAddress)(sponsor.publicKey());
const channelKey = channelKeypair(feePayer, 0);
const channel = Schema.decodeSync(AccountAddress)(channelKey.publicKey());
const to = Schema.decodeSync(AccountAddress)(Keypair.random().publicKey());

const chainLayer = chainWithHttp(FetchHttpClient.layer, {
  rpcUrl: "https://soroban-testnet.stellar.org",
  sponsor,
  feePayer,
});

const decodeTx = (raw: string) => {
  const tx = TransactionBuilder.fromXDR(raw, networkPassphrase);

  if (!(tx instanceof Transaction)) throw new Error("Expected transaction");

  return tx;
};

const decodeFeeBump = (raw: string) => {
  const tx = TransactionBuilder.fromXDR(raw, networkPassphrase);

  if (!(tx instanceof FeeBumpTransaction)) throw new Error("Expected fee bump");

  return tx;
};

const seal = (envelope: UnsignedEnvelope, expires: number) =>
  Chain.use((c) =>
    c.seal(
      new SigningRequest({
        envelope,
        expiresAt: DateTime.makeUnsafe(expires * 1000),
      }),
      new Approval({ signature: holder.sign(signingPayload(envelope)) }),
      address,
    ),
  ).pipe(Effect.provide(chainLayer));

const missingResponse = (
  hash: string,
  now: number,
  overrides: Partial<rpc.Api.GetMissingTransactionResponse> = {},
): rpc.Api.GetMissingTransactionResponse => ({
  status: rpc.Api.GetTransactionStatus.NOT_FOUND,
  txHash: hash,
  latestLedger: 100,
  latestLedgerCloseTime: now + 121,
  oldestLedger: 1,
  oldestLedgerCloseTime: now - 1,
  ...overrides,
});

const accountSnapshot = (
  overrides: Partial<AccountState> = {},
): AccountState => ({
  sequence: "123",
  nativeBalance: 0n,
  balance: Option.none(),
  ledger: 100,
  accountSponsored: true,
  sponsored: true,
  untouched: true,
  ...overrides,
});

const sealedPaymentAt = (now: number) =>
  seal(
    draftPayment({
      asset: baseAsset,
      source: new Account(address, "123"),
      to,
      amount: Schema.decodeSync(PositiveAmount)("1"),
      minTime: now,
      maxTime: now + 120,
    }),
    now + 120,
  );

const baseAssetPrecision = precisionOf(baseAsset);

const sixDecimals: AssetPrecision = {
  decimals: 6,
  maximum: 18_446_744_073_709_551_615n,
};

it.each([
  ["zero", "0", baseAssetPrecision],
  ["negative", "-1", baseAssetPrecision],
  ["scientific notation", "1e2", baseAssetPrecision],
  ["more decimals than the base asset", "1.00000001", baseAssetPrecision],
  ["above the base asset maximum", "922337203685.4775808", baseAssetPrecision],
  ["more decimals than a six-decimal asset", "1.0000001", sixDecimals],
  ["above a six-decimal asset maximum", "18446744073709.551616", sixDecimals],
])("money parsing rejects %s", (_name, value, precision) => {
  expect(Option.isNone(parseAmount(value, precision))).toBe(true);
});

it.each([
  ["base asset amounts", "5.5000001", "55000001", baseAssetPrecision],
  [
    "the base asset maximum",
    "922337203685.4775807",
    "9223372036854775807",
    baseAssetPrecision,
  ],
  ["six-decimal amounts", "5.500001", "5500001", sixDecimals],
  [
    "a six-decimal asset maximum",
    "18446744073709.551615",
    "18446744073709551615",
    sixDecimals,
  ],
])("money round-trips %s", (_name, text, units, precision) => {
  const amount = Schema.decodeSync(PositiveAmount)(units);

  expect(parseAmount(text, precision)).toStrictEqual(Option.some(amount));
  expect(formatAmount(amount, precision)).toBe(text);
});

it.each([
  ["at", "9223372036854775807", true],
  ["above", "9223372036854775808", false],
])(
  "accepts a transfer order %s the asset maximum only within it",
  (_name, amount, accepted) => {
    const decoded = Schema.decodeUnknownOption(TransferOrder)({
      id: "6f1f3c1e-9a2b-4c3d-8e4f-5a6b7c8d9e0f",
      from: address,
      to: AddressRecipient.make({ value: to }),
      asset: baseAsset,
      amount,
    });

    expect(Option.isSome(decoded)).toBe(accepted);
  },
);

it("payment envelopes preserve amount, destination, bounds and next sequence", () => {
  const amount = Schema.decodeSync(PositiveAmount)("55000001");

  const envelope = draftPayment({
    asset: baseAsset,
    source: new Account(address, "9007199254740993"),
    to,
    amount,
    minTime: 100,
    maxTime: 220,
  });

  expect(decodeTx(envelope).operations[0]).toMatchObject({
    type: "payment",
    destination: to,
    amount: "5.5000001",
  });
  expect(Option.getOrThrow(readEnvelope(envelope))).toEqual(
    new PaymentFacts({
      asset: baseAsset,
      from: address,
      to,
      amount,
      sequence: "9007199254740994",
      minTime: 100,
      maxTime: 220,
    }),
  );
});

it.each([
  [
    "creation",
    true,
    [
      {
        type: "beginSponsoringFutureReserves",
        source: reserveSponsor,
        sponsoredId: address,
      },
      {
        type: "createAccount",
        source: reserveSponsor,
        destination: address,
        startingBalance: "0.0000000",
      },
      { type: "changeTrust", source: address },
      { type: "endSponsoringFutureReserves", source: address },
    ],
  ],
  [
    "trustline repair",
    false,
    [
      {
        type: "beginSponsoringFutureReserves",
        source: reserveSponsor,
        sponsoredId: address,
      },
      { type: "changeTrust", source: address },
      { type: "endSponsoringFutureReserves", source: address },
    ],
  ],
] as const)("opening supports the %s sandwich", (_name, createAccount, ops) => {
  const envelope = draftOpening({
    channel: new Account(channel, "123"),
    reserveSponsor,
    address,
    createAccount,
    minTime: 100,
    maxTime: 220,
  });

  const tx = decodeTx(envelope);

  expect(tx.source).toBe(channel);
  expect(tx.operations).toMatchObject(ops);
  expect(Option.getOrThrow(readEnvelope(envelope))).toEqual(
    new OpeningFacts({
      channel,
      address,
      reserveSponsor,
      createAccount,
      sequence: "124",
      minTime: 100,
      maxTime: 220,
    }),
  );
});

const samplePayment = Operation.payment({
  destination: to,
  asset: usdc,
  amount: "1",
});

const buildTx = (options: {
  fee?: string;
  memo?: Memo;
  ops?: ReadonlyArray<xdr.Operation>;
}) => {
  const builder = new TransactionBuilder(new Account(address, "123"), {
    fee: options.fee ?? baseFee,
    networkPassphrase,
    memo: options.memo,
  });

  for (const op of options.ops ?? [samplePayment]) builder.addOperation(op);

  return builder.setTimebounds(100, 220).build().toXDR();
};

it.each([
  ["unsupported memo", buildTx({ memo: Memo.hash(new Uint8Array(32)) })],
  ["extra operations", buildTx({ ops: [samplePayment, samplePayment] })],
  [
    "operation source",
    buildTx({
      ops: [
        Operation.payment({
          source: to,
          destination: to,
          asset: usdc,
          amount: "1",
        }),
      ],
    }),
  ],
  ["non-base fee", buildTx({ fee: "200" })],
])("reader rejects %s", (_name, raw) => {
  expect(
    Option.isNone(readEnvelope(Schema.decodeSync(UnsignedEnvelope)(raw))),
  ).toBe(true);
});

it.live(
  "seal verifies the holder, signs with its pool channel and uses a distinct fee payer without modifying the draft",
  () =>
    Effect.gen(function* () {
      const now = Math.floor(Date.now() / 1000);

      const envelope = draftOpening({
        channel: new Account(channel, "123"),
        reserveSponsor,
        address,
        createAccount: true,
        minTime: now,
        maxTime: now + 120,
      });

      const sealed = yield* seal(envelope, now + 120);
      const draftTx = decodeTx(envelope);
      const outer = decodeFeeBump(sealed.envelope);

      expect(outer.feeSource).toBe(feePayer.publicKey());
      expect(outer.innerTransaction.tx.toXDR("base64")).toBe(
        draftTx.tx.toXDR("base64"),
      );
      expect(outer.innerTransaction.hash()).toEqual(draftTx.hash());
      expect(
        outer.innerTransaction.signatures.map((signature) =>
          signature.hint.toXDR("hex"),
        ),
      ).toEqual(
        [holder, sponsor, channelKey].map((signer) =>
          Buffer.from(signer.signatureHint()).toString("hex"),
        ),
      );
      expect(
        Option.isNone(
          readEnvelope(Schema.decodeSync(UnsignedEnvelope)(sealed.envelope)),
        ),
      ).toBe(true);

      const outsidePool = draftOpening({
        channel: new Account(feePayer.publicKey(), "123"),
        reserveSponsor,
        address,
        createAccount: true,
        minTime: now,
        maxTime: now + 120,
      });

      assertTagged(
        yield* seal(outsidePool, now + 120).pipe(Effect.flip),
        "ApprovalInvalid",
      );

      const invalid = yield* Chain.use((c) =>
        c.seal(
          new SigningRequest({
            envelope,
            expiresAt: DateTime.makeUnsafe((now + 120) * 1000),
          }),
          new Approval({ signature: new Uint8Array(64) }),
          address,
        ),
      ).pipe(Effect.flip, Effect.provide(chainLayer));

      expect(invalid._tag).toBe("ApprovalInvalid");
    }),
);

it.live(
  "absence only concludes with complete inner-hash history and aligned ledgers",
  () =>
    Effect.gen(function* () {
      const now = Math.floor(Date.now() / 1000);
      const sealed = yield* sealedPaymentAt(now);

      expect(
        settlementFromResponse(
          missingResponse(sealed.hash, now, {
            latestLedgerCloseTime: now + 120,
          }),
          sealed,
          Option.some(accountSnapshot()),
        )._tag,
      ).toBe("Undecided");

      const reader = (
        tx: Partial<rpc.Api.GetMissingTransactionResponse> = {},
        account: Partial<AccountState> = {},
      ): SettlementReader => ({
        transaction: (hash) => Effect.succeed(missingResponse(hash, now, tx)),
        account: () => Effect.succeed(Option.some(accountSnapshot(account))),
      });

      expect(
        yield* resolveSettlement(sealed, reader({}, { sequence: "124" })),
      ).toEqual(new Rejected({ code: "sequence_consumed" }));
      expect(
        (yield* resolveSettlement(
          sealed,
          reader(
            { oldestLedger: 90, oldestLedgerCloseTime: now + 1 },
            { sequence: "124" },
          ),
        ))._tag,
      ).toBe("Undecided");
      expect(
        (yield* resolveSettlement(
          sealed,
          reader({ latestLedger: 99 }, { sequence: "124" }),
        ))._tag,
      ).toBe("Undecided");
      expect((yield* resolveSettlement(sealed, reader()))._tag).toBe("Expired");
      expect(
        (yield* resolveSettlement(sealed, reader({}, { ledger: 99 })))._tag,
      ).toBe("Undecided");
    }),
);

it.live(
  "settlement discovers the same inner transaction under a different fee payer",
  () =>
    Effect.gen(function* () {
      const now = Math.floor(Date.now() / 1000);
      const sealed = yield* sealedPaymentAt(now);
      const other = Keypair.random();

      const replacement = TransactionBuilder.buildFeeBumpTransaction(
        other.publicKey(),
        baseFee,
        decodeFeeBump(sealed.envelope).innerTransaction,
        networkPassphrase,
      );

      replacement.sign(other);

      const applied: rpc.Api.GetSuccessfulTransactionResponse = {
        ...missingResponse("alternate fee bump", now),
        status: rpc.Api.GetTransactionStatus.SUCCESS,
        ledger: 90,
        createdAt: now + 20,
        applicationOrder: 1,
        feeBump: true,
        envelopeXdr: replacement.toEnvelope(),
        resultXdr: new xdr.TransactionResult({
          feeCharged: 200n,
          result: xdr.TransactionResultResult.txSuccess([]),
          ext: xdr.TransactionResultExt.v0(),
        }),
        resultMetaXdr: xdr.TransactionMeta.operations([]),
        events: { contractEventsXdr: [], transactionEventsXdr: [] },
      };

      const reader: SettlementReader = {
        transaction: (hash) =>
          Effect.succeed(
            hash === sealed.hash ? missingResponse(hash, now) : applied,
          ),
        account: () =>
          Effect.die("A confirmed inner result needs no sequence inference"),
      };

      expect(yield* resolveSettlement(sealed, reader)).toEqual(
        new Applied({ at: DateTime.makeUnsafe((now + 20) * 1000) }),
      );
    }),
);

it("sponsorship requires matching account and trustline sponsors, not sponsored counts", () => {
  const account = accountEntryXdr(holder, 123n, 1);

  const trust = xdr.LedgerEntryData.trustline(
    new xdr.TrustLineEntry({
      accountId: holder.xdrPublicKey(),
      asset: usdc.toTrustLineXdrObject(),
      balance: 0n,
      limit: 9223372036854775807n,
      flags: 1,
      ext: xdr.TrustLineEntryExt.v0(),
    }),
  ).toXDR("base64");

  const sponsoredBy = (key: Keypair) =>
    xdr.LedgerEntryExt.v1(
      new xdr.LedgerEntryExtensionV1({
        sponsoringId: key.xdrPublicKey(),
        ext: xdr.LedgerEntryExtensionV1Ext.v0(),
      }),
    ).toXDR("base64");

  const state = (
    entries: ReadonlyArray<{ readonly xdr: string; readonly extXdr?: string }>,
  ) => Option.getOrThrow(accountFromEntries(entries, 100, reserveSponsor));

  const ownedAccount = { xdr: account, extXdr: sponsoredBy(sponsor) };
  const ownedTrust = { xdr: trust, extXdr: sponsoredBy(sponsor) };

  expect(state([ownedAccount, ownedTrust]).sponsored).toBe(true);
  expect(state([{ xdr: account }, { xdr: trust }]).sponsored).toBe(false);
  expect(
    state([{ xdr: account, extXdr: sponsoredBy(feePayer) }, ownedTrust])
      .accountSponsored,
  ).toBe(false);
  expect(
    state([ownedAccount, { xdr: trust, extXdr: sponsoredBy(feePayer) }])
      .sponsored,
  ).toBe(false);
});

it.live.each([
  ["UTF-8 text", { type: "text", value: "exchange dépôt 🪷" }],
  ["max uint64 id", { type: "id", value: "18446744073709551615" }],
] as const)("valid %s memo survives reading and sealing", ([, memo]) =>
  Effect.gen(function* () {
    const now = Math.floor(Date.now() / 1000);
    const checked = Schema.decodeUnknownSync(PaymentMemo)(memo);

    const envelope = draftPayment({
      asset: baseAsset,
      source: new Account(address, "123"),
      to,
      amount: Schema.decodeSync(PositiveAmount)("1"),
      minTime: now,
      maxTime: now + 120,
      memo: checked,
    });

    const facts = Option.getOrThrow(readEnvelope(envelope));

    assertTagged(facts, "PaymentFacts");
    expect(facts.memo).toEqual(checked);

    const sealed = yield* seal(envelope, now + 120);
    const outer = decodeFeeBump(sealed.envelope);

    const expected =
      checked.type === "text"
        ? Memo.text(checked.value)
        : Memo.id(checked.value);

    expect(outer.innerTransaction.memo.toXdrObject().toXDR("base64")).toBe(
      expected.toXdrObject().toXDR("base64"),
    );
  }),
);

it.each([
  ["over 28 UTF-8 bytes", { type: "text", value: "é".repeat(15) }],
  ["unpaired surrogate", { type: "text", value: "\uD800" }],
  ["uint64 overflow", { type: "id", value: "18446744073709551616" }],
  ["hash memo", { type: "hash", value: "abc" }],
])("PaymentMemo schema rejects %s", (_name, memo) => {
  expect(Option.isNone(Schema.decodeUnknownOption(PaymentMemo)(memo))).toBe(
    true,
  );
});

it.live(
  "a sealed link receive is signed by the holder, the reserve sponsor and its channel",
  () =>
    Effect.gen(function* () {
      const now = Math.floor(Date.now() / 1000);

      const envelope = draftLinkReceive({
        channel: new Account(channel, "123"),
        link: address,
        reserveSponsor,
        createsLinkAccount: true,
        destination: Schema.decodeSync(DestinationAddress)(to),
        unclaimedFunds: Schema.decodeSync(UnclaimedFundsId)(
          `00000000${"ab".repeat(32)}`,
        ),
        asset: baseAsset,
        amount: Schema.decodeSync(PositiveAmount)("10000000"),
        minTime: now,
        maxTime: now + 120,
      });

      const sealed = yield* Chain.use((c) =>
        c.seal(
          new SigningRequest({
            envelope,
            expiresAt: DateTime.makeUnsafe((now + 120) * 1000),
          }),
          new Approval({ signature: holder.sign(signingPayload(envelope)) }),
          address,
        ),
      ).pipe(Effect.provide(chainLayer));

      expect(
        decodeFeeBump(sealed.envelope).innerTransaction.signatures.map(
          (signature) => signature.hint.toXDR("hex"),
        ),
      ).toEqual(
        [holder, sponsor, channelKey].map((signer) =>
          Buffer.from(signer.signatureHint()).toString("hex"),
        ),
      );
    }),
);
