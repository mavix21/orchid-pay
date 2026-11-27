import {
  Account,
  Keypair,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import { Database } from "@workspace/db";
import {
  AccountAddress,
  type DestinationAddress,
  type Approval,
  type Asset,
  OpeningDraft,
  type PaymentMemo,
  type PositiveAmount,
  SigningRequest,
} from "../contract";
import { approvalMargin, draftLifetime } from "../policy";
import {
  ApprovalInvalid,
  Chain,
  ChainUnreachable,
  Sealed,
  SubmissionRejected,
} from "../server/Chain.server";
import {
  validateRpcTimeout,
  validateRpcUrl,
} from "../server/rpc-settings.server";
import { WalletSettings, rpcReadConcurrency } from "../server/settings.server";
import { accountChain } from "./account-chain.server";
import { isMuxedAddress, stellarAddressRules } from "./address-rules";
import { assetChain } from "./asset-chain.server";
import { channelPool } from "./channel-pool.server";
import { depositChain } from "./deposit-chain.server";
import { baseAccountOf } from "./destination";
import { destinationChain } from "./destination-chain.server";
import { draftChain } from "./draft-chain.server";
import { draftOpening, draftPayment, readEnvelope } from "./envelopes";
import { memoRequirementFor } from "./exchange-memos.server";
import { accountFromEntries, stellarRpc } from "./ledger.server";
import { linkChain } from "./link-chain.server";
import { baseFee, networkPassphrase, usdc } from "./network";
import {
  RawTransactionLookup,
  resolveSettlement,
  resultCode,
  transactionLookup,
} from "./settlement.server";

const RawSendTransaction = Schema.Union([
  Schema.Struct({ status: Schema.Literal("PENDING") }),
  Schema.Struct({ status: Schema.Literal("DUPLICATE") }),
  Schema.Struct({ status: Schema.Literal("TRY_AGAIN_LATER") }),
  Schema.Struct({
    status: Schema.Literal("ERROR"),
    errorResultXdr: Schema.optional(Schema.String),
  }),
]);

export const stellarChainLayer = Layer.effect(
  Chain,
  Effect.gen(function* () {
    const settings = yield* WalletSettings;
    const rpcUrl = yield* validateRpcUrl(settings.rpcUrl);
    const rpcTimeout = yield* validateRpcTimeout(settings.rpcTimeout);
    const rpc = stellarRpc(yield* HttpClient.HttpClient, rpcUrl, rpcTimeout);

    const sponsor = Keypair.fromSecret(
      Redacted.value(settings.reserveSponsorSecret),
    );

    const feePayer = Keypair.fromSecret(
      Redacted.value(settings.feePayerSecret),
    );

    const sponsorAddress = Schema.decodeSync(AccountAddress)(
      sponsor.publicKey(),
    );

    const account = Effect.fn("Chain.account")(function* (
      address: AccountAddress,
    ) {
      const keys = [
        xdr.LedgerKey.account(
          new xdr.LedgerKeyAccount({
            accountId: Keypair.fromPublicKey(address).xdrPublicKey(),
          }),
        ),
        xdr.LedgerKey.trustline(
          new xdr.LedgerKeyTrustLine({
            accountId: Keypair.fromPublicKey(address).xdrAccountId(),
            asset: usdc.toTrustLineXdrObject(),
          }),
        ),
      ];

      const response = yield* rpc.entries(keys);

      return accountFromEntries(
        response.entries ?? [],
        response.latestLedger,
        sponsorAddress,
      );
    });

    const channels = channelPool(feePayer, yield* Database, account);

    const source = Effect.fn("Chain.source")(function* (
      address: AccountAddress,
    ) {
      const state = yield* account(address);

      if (Option.isNone(state))
        return yield* Effect.die(new Error("Account does not exist"));

      return new Account(address, state.value.sequence);
    });

    const request = (envelope: SigningRequest["envelope"], maxTime: number) =>
      new SigningRequest({
        envelope,
        expiresAt: DateTime.makeUnsafe(maxTime * 1000),
      });

    const draftOpen = Effect.fn("Chain.draftOpening")(function* (
      address: AccountAddress,
    ) {
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);

      const [channel, current] = yield* Effect.all(
        [channels.lease(now + draftLifetime), account(address)],
        { concurrency: rpcReadConcurrency },
      );

      return new OpeningDraft({
        request: request(
          draftOpening({
            channel,
            reserveSponsor: sponsorAddress,
            address,
            minTime: now,
            maxTime: now + draftLifetime,
            createAccount: Option.isNone(current),
          }),
          now + draftLifetime,
        ),
      });
    });

    const draftPay = Effect.fn("Chain.draftPayment")(function* (
      from: AccountAddress,
      to: DestinationAddress,
      asset: Asset,
      amount: PositiveAmount,
      memo?: PaymentMemo,
    ) {
      const holder = yield* source(from);
      const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);

      return request(
        draftPayment({
          source: holder,
          to,
          asset,
          amount,
          memo,
          minTime: now,
          maxTime: now + draftLifetime,
        }),
        now + draftLifetime,
      );
    });

    const seal = (
      signingRequest: SigningRequest,
      approval: Approval,
      holder: AccountAddress,
    ) =>
      Clock.currentTimeMillis.pipe(
        Effect.flatMap((now) =>
          Effect.try({
            try: () => {
              const facts = readEnvelope(signingRequest.envelope);

              if (Option.isNone(facts)) throw new Error("Invalid layout");

              const permitted = Match.valueTags(facts.value, {
                OpeningFacts: (f) =>
                  f.address === holder &&
                  f.reserveSponsor === sponsorAddress &&
                  Option.isSome(channels.signer(f.channel)),
                PaymentFacts: (f) => f.from === holder,
                TrustlineFacts: (f) =>
                  f.address === holder && f.reserveSponsor === sponsorAddress,
                TrustlineRemovalFacts: (f) => f.address === holder,
                ClaimableFacts: (f) =>
                  f.from === holder && f.reserveSponsor === sponsorAddress,
                PaymentLinkFacts: (f) =>
                  f.from === holder &&
                  f.to !== holder &&
                  f.reserveSponsor === sponsorAddress,
                ClaimFacts: (f) =>
                  f.address === holder &&
                  (!f.reserveSponsor || f.reserveSponsor === sponsorAddress),
                LinkReceiveFacts: (f) =>
                  f.link === holder &&
                  baseAccountOf(f.destination) !== holder &&
                  (!isMuxedAddress(f.destination) || f.memo === undefined) &&
                  Option.isSome(channels.signer(f.channel)) &&
                  f.reserveSponsor === sponsorAddress,
              });

              const sponsoring = Match.valueTags(facts.value, {
                OpeningFacts: () => true,
                PaymentFacts: () => false,
                TrustlineFacts: () => true,
                TrustlineRemovalFacts: () => false,
                ClaimableFacts: () => true,
                PaymentLinkFacts: () => true,
                ClaimFacts: (f) => f.reserveSponsor !== undefined,
                LinkReceiveFacts: () => true,
              });

              if (
                !permitted ||
                facts.value.maxTime * 1000 !==
                  DateTime.toEpochMillis(signingRequest.expiresAt) ||
                DateTime.toEpochMillis(signingRequest.expiresAt) <
                  now + approvalMargin * 1000
              )
                throw new Error("Invalid or stale approval");

              const inner = TransactionBuilder.fromXDR(
                signingRequest.envelope,
                networkPassphrase,
              );

              if (!(inner instanceof Transaction))
                throw new Error("Inner transaction required");

              inner.addSignature(
                holder,
                btoa(String.fromCharCode(...approval.signature)),
              );

              if (sponsoring) inner.sign(sponsor);

              const channel =
                Predicate.isTagged(facts.value, "OpeningFacts") ||
                Predicate.isTagged(facts.value, "LinkReceiveFacts")
                  ? channels.signer(facts.value.channel)
                  : Option.none();

              if (Option.isSome(channel)) inner.sign(channel.value);

              const outer = TransactionBuilder.buildFeeBumpTransaction(
                feePayer.publicKey(),
                baseFee,
                inner,
                networkPassphrase,
              );

              outer.sign(feePayer);

              return new Sealed({
                envelope: outer.toXDR(),
                hash: Array.from(outer.hash(), (byte) =>
                  byte.toString(16).padStart(2, "0"),
                ).join(""),
                expiresAt: signingRequest.expiresAt,
              });
            },
            catch: () => new ApprovalInvalid(),
          }),
        ),
      );

    const submit = (sealed: Sealed) =>
      rpc
        .call(
          "sendTransaction",
          { transaction: sealed.envelope },
          RawSendTransaction,
        )
        .pipe(
          Effect.flatMap((reply) =>
            Match.value(reply).pipe(
              Match.when({ status: "PENDING" }, () => Effect.void),
              Match.when({ status: "DUPLICATE" }, () => Effect.void),
              Match.when({ status: "TRY_AGAIN_LATER" }, () =>
                Effect.fail(
                  new ChainUnreachable({
                    cause: new Error(
                      "Stellar RPC sendTransaction returned TRY_AGAIN_LATER",
                    ),
                  }),
                ),
              ),
              Match.when({ status: "ERROR" }, ({ errorResultXdr }) =>
                Effect.fail(
                  errorResultXdr === undefined
                    ? new SubmissionRejected({})
                    : new SubmissionRejected({
                        code: resultCode(
                          xdr.TransactionResult.fromXDR(
                            errorResultXdr,
                            "base64",
                          ),
                        ),
                      }),
                ),
              ),
              Match.exhaustive,
            ),
          ),
        );

    const transaction = (hash: string) =>
      rpc
        .call("getTransaction", { hash }, RawTransactionLookup)
        .pipe(Effect.map(transactionLookup));

    const settlement = (sealed: Sealed) =>
      resolveSettlement(sealed, { transaction, account });

    const pastOpeningWindow = (sealed: Sealed) =>
      rpc
        .call(
          "getLatestLedger",
          {},
          Schema.Struct({ closeTime: Schema.NumberFromString }),
        )
        .pipe(
          Effect.map(
            ({ closeTime }) =>
              closeTime * 1000 > DateTime.toEpochMillis(sealed.expiresAt),
          ),
        );

    const assets = assetChain(rpc, sponsorAddress, source);

    const links = linkChain(
      sponsor,
      feePayer,
      account,
      channels.lease,
      (envelope) =>
        rpc
          .call(
            "sendTransaction",
            { transaction: envelope },
            RawSendTransaction,
          )
          .pipe(Effect.ignore),
    );

    return Chain.of({
      ...accountChain(account),
      ...assets,
      ...destinationChain(assets.holdings, (address) =>
        memoRequirementFor(rpc, address),
      ),
      ...draftChain(account),
      ...depositChain(rpc),
      validAddress: stellarAddressRules.hasValidChecksum,
      pastOpeningWindow,
      draftOpening: draftOpen,
      draftPayment: draftPay,
      ...links,
      seal,
      submit,
      settlement,
    });
  }),
);
