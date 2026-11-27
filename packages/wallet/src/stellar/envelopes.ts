import {
  Account,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  Asset,
  DestinationAddress,
  PaymentMemo,
  PositiveAmount,
  UnsignedEnvelope,
  formatAmount,
  parseAmount,
  precisionOf,
} from "../contract";
import { type AssetFacts, readAssetEnvelope } from "./asset-envelopes";
import { fromStellarAsset, toStellarAsset } from "./assets";
import { bounds } from "./bounds";
import { type LinkReceiveFacts, readLinkReceive } from "./link-receive";
import { fromStellarMemo, toStellarMemo } from "./memo";
import { baseFee, networkPassphrase, usdc } from "./network";

export type EnvelopeFacts =
  | OpeningFacts
  | PaymentFacts
  | AssetFacts
  | LinkReceiveFacts;

export class OpeningFacts extends Schema.TaggedClass<OpeningFacts>()(
  "OpeningFacts",
  {
    ...bounds,
    channel: AccountAddress,
    address: AccountAddress,
    reserveSponsor: AccountAddress,
    createAccount: Schema.Boolean,
  },
) {}

export class PaymentFacts extends Schema.TaggedClass<PaymentFacts>()(
  "PaymentFacts",
  {
    ...bounds,
    from: AccountAddress,
    to: DestinationAddress,
    asset: Asset,
    amount: PositiveAmount,
    memo: Schema.optional(PaymentMemo),
  },
) {}

export interface OpeningInput {
  readonly channel: Account;
  readonly reserveSponsor: AccountAddress;
  readonly address: AccountAddress;
  readonly minTime: number;
  readonly maxTime: number;
  readonly createAccount: boolean;
}

export interface PaymentInput {
  readonly source: Account;
  readonly to: DestinationAddress;
  readonly asset: Asset;
  readonly amount: PositiveAmount;
  readonly memo?: PaymentMemo;
  readonly minTime: number;
  readonly maxTime: number;
}

export function draftOpening(input: OpeningInput): UnsignedEnvelope {
  const builder = new TransactionBuilder(input.channel, {
    fee: baseFee,
    networkPassphrase,
  }).addOperation(
    Operation.beginSponsoringFutureReserves({
      source: input.reserveSponsor,
      sponsoredId: input.address,
    }),
  );

  if (input.createAccount)
    builder.addOperation(
      Operation.createAccount({
        source: input.reserveSponsor,
        destination: input.address,
        startingBalance: "0",
      }),
    );

  builder.addOperation(
    Operation.changeTrust({ source: input.address, asset: usdc }),
  );

  builder.addOperation(
    Operation.endSponsoringFutureReserves({ source: input.address }),
  );

  return Schema.decodeSync(UnsignedEnvelope)(
    builder.setTimebounds(input.minTime, input.maxTime).build().toXDR(),
  );
}

export function draftPayment(input: PaymentInput): UnsignedEnvelope {
  return Schema.decodeSync(UnsignedEnvelope)(
    new TransactionBuilder(input.source, {
      fee: baseFee,
      networkPassphrase,
      memo: toStellarMemo(input.memo),
    })
      .addOperation(
        Operation.payment({
          destination: input.to,
          asset: toStellarAsset(input.asset),
          amount: formatAmount(input.amount, precisionOf(input.asset)),
        }),
      )
      .setTimebounds(input.minTime, input.maxTime)
      .build()
      .toXDR(),
  );
}

export function readEnvelope(
  envelope: UnsignedEnvelope,
): Option.Option<EnvelopeFacts> {
  try {
    const tx = TransactionBuilder.fromXDR(envelope, networkPassphrase);

    if (
      !(tx instanceof Transaction) ||
      tx.signatures.length !== 0 ||
      !tx.timeBounds
    )
      return Option.none();

    const minTime = Number(tx.timeBounds.minTime);
    const maxTime = Number(tx.timeBounds.maxTime);

    const source = () =>
      new Account(tx.source, (BigInt(tx.sequence) - 1n).toString());

    const fields = { sequence: tx.sequence, minTime, maxTime };
    const [first, second] = tx.operations;

    if (
      !Number.isSafeInteger(minTime) ||
      !Number.isSafeInteger(maxTime) ||
      minTime < 0 ||
      maxTime <= minTime ||
      BigInt(tx.sequence) <= 0n
    )
      return Option.none();

    if (first?.type === "beginSponsoringFutureReserves" && first.source) {
      const address = Schema.decodeSync(AccountAddress)(first.sponsoredId);
      const reserveSponsor = Schema.decodeSync(AccountAddress)(first.source);
      const channel = Schema.decodeSync(AccountAddress)(tx.source);
      const createAccount = second?.type === "createAccount";

      if (
        draftOpening({
          channel: source(),
          reserveSponsor,
          address,
          minTime,
          maxTime,
          createAccount,
        }) === envelope
      )
        return Option.some(
          new OpeningFacts({
            ...fields,
            channel,
            address,
            reserveSponsor,
            createAccount,
          }),
        );
    }

    if (first?.type === "payment") {
      const reference = fromStellarMemo(tx.memo);
      const payment = reference ? { memo: reference } : {};
      const asset = fromStellarAsset(first.asset);
      const amount = parseAmount(first.amount, precisionOf(asset));
      const from = Schema.decodeSync(AccountAddress)(tx.source);
      const to = Schema.decodeSync(DestinationAddress)(first.destination);

      if (
        Option.isSome(amount) &&
        draftPayment({
          source: source(),
          to,
          asset,
          amount: amount.value,
          minTime,
          maxTime,
          ...payment,
        }) === envelope
      )
        return Option.some(
          new PaymentFacts({
            ...fields,
            from,
            to,
            asset,
            amount: amount.value,
            ...payment,
          }),
        );
    }

    return Option.orElse(readAssetEnvelope(tx, envelope, fields), () =>
      readLinkReceive(tx, envelope, fields),
    );
  } catch {
    return Option.none();
  }
}

export function signingPayload(envelope: UnsignedEnvelope): Uint8Array {
  return TransactionBuilder.fromXDR(envelope, networkPassphrase).hash();
}
