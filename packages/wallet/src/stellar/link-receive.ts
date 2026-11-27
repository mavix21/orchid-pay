import {
  Account,
  Operation,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  Asset,
  UnclaimedFundsId,
  DestinationAddress,
  PaymentMemo,
  PositiveAmount,
  UnsignedEnvelope,
  formatAmount,
  needsTrustline,
  parseAmount,
  precisionOf,
} from "../contract";
import { fromStellarAsset, toStellarAsset } from "./assets";
import { bounds } from "./bounds";
import { isMuxedAddress } from "./address-rules";
import { fromStellarMemo, toStellarMemo } from "./memo";
import { baseFee, networkPassphrase } from "./network";

export class LinkReceiveFacts extends Schema.TaggedClass<LinkReceiveFacts>()(
  "LinkReceiveFacts",
  {
    ...bounds,
    channel: AccountAddress,
    link: AccountAddress,
    reserveSponsor: AccountAddress,
    createsLinkAccount: Schema.Boolean,
    destination: DestinationAddress,
    unclaimedFunds: UnclaimedFundsId,
    asset: Asset,
    amount: PositiveAmount,
    memo: Schema.optional(PaymentMemo),
  },
) {}

export interface LinkReceiveInput {
  readonly channel: Account;
  readonly link: AccountAddress;
  readonly reserveSponsor: AccountAddress;
  readonly createsLinkAccount: boolean;
  readonly destination: DestinationAddress;
  readonly unclaimedFunds: UnclaimedFundsId;
  readonly asset: Asset;
  readonly amount: PositiveAmount;
  readonly memo?: PaymentMemo;
  readonly minTime: number;
  readonly maxTime: number;
}

export function draftLinkReceive(input: LinkReceiveInput): UnsignedEnvelope {
  const asset = toStellarAsset(input.asset);
  const amount = formatAmount(input.amount, precisionOf(input.asset));
  const trusts = needsTrustline(input.asset);

  const builder = new TransactionBuilder(input.channel, {
    fee: baseFee,
    networkPassphrase,
    memo: toStellarMemo(input.memo),
  }).addOperation(
    Operation.beginSponsoringFutureReserves({
      source: input.reserveSponsor,
      sponsoredId: input.link,
    }),
  );

  if (input.createsLinkAccount)
    builder.addOperation(
      Operation.createAccount({
        source: input.reserveSponsor,
        destination: input.link,
        startingBalance: "0",
      }),
    );

  if (trusts)
    builder.addOperation(
      Operation.changeTrust({ source: input.link, asset, limit: amount }),
    );

  builder
    .addOperation(
      Operation.claimClaimableBalance({
        source: input.link,
        balanceId: input.unclaimedFunds,
      }),
    )
    .addOperation(
      Operation.payment({
        source: input.link,
        destination: input.destination,
        asset,
        amount,
      }),
    );

  if (trusts)
    builder.addOperation(
      Operation.changeTrust({ source: input.link, asset, limit: "0" }),
    );

  return Schema.decodeSync(UnsignedEnvelope)(
    builder
      .addOperation(
        Operation.setOptions({
          source: input.link,
          masterWeight: 0,
          lowThreshold: 1,
          medThreshold: 1,
          highThreshold: 1,
          signer: { ed25519PublicKey: input.reserveSponsor, weight: 1 },
        }),
      )
      .addOperation(
        Operation.endSponsoringFutureReserves({ source: input.link }),
      )
      .setTimebounds(input.minTime, input.maxTime)
      .build()
      .toXDR(),
  );
}

export function draftLinkCleanup(
  link: Account,
  reserveSponsor: AccountAddress,
  maxTime: number,
): Transaction {
  return new TransactionBuilder(link, { fee: baseFee, networkPassphrase })
    .addOperation(Operation.accountMerge({ destination: reserveSponsor }))
    .setTimebounds(0, maxTime)
    .build();
}

export function readLinkReceive(
  tx: Transaction,
  envelope: UnsignedEnvelope,
  fields: {
    readonly sequence: string;
    readonly minTime: number;
    readonly maxTime: number;
  },
): Option.Option<LinkReceiveFacts> {
  const sponsoring = tx.operations[0];
  const createsLinkAccount = tx.operations[1]?.type === "createAccount";
  const claim = tx.operations.find((op) => op.type === "claimClaimableBalance");
  const payment = tx.operations.find((op) => op.type === "payment");

  if (
    sponsoring?.type !== "beginSponsoringFutureReserves" ||
    !sponsoring.source ||
    claim?.type !== "claimClaimableBalance" ||
    payment?.type !== "payment"
  )
    return Option.none();

  const received = fromStellarAsset(payment.asset);
  const amount = parseAmount(payment.amount, precisionOf(received));

  if (Option.isNone(amount)) return Option.none();

  const destination = Schema.decodeSync(DestinationAddress)(
    payment.destination,
  );

  const memo = fromStellarMemo(tx.memo);

  if (isMuxedAddress(destination) && memo !== undefined) return Option.none();

  const facts = new LinkReceiveFacts({
    ...fields,
    channel: Schema.decodeSync(AccountAddress)(tx.source),
    link: Schema.decodeSync(AccountAddress)(sponsoring.sponsoredId),
    reserveSponsor: Schema.decodeSync(AccountAddress)(sponsoring.source),
    createsLinkAccount,
    destination,
    unclaimedFunds: Schema.decodeSync(UnclaimedFundsId)(claim.balanceId),
    asset: received,
    amount: amount.value,
    memo,
  });

  return draftLinkReceive({
    ...facts,
    channel: new Account(facts.channel, (BigInt(tx.sequence) - 1n).toString()),
  }) === envelope
    ? Option.some(facts)
    : Option.none();
}
