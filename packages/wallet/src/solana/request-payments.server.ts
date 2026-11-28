import { ed25519 } from "@noble/curves/ed25519.js";
import {
  type Address,
  address,
  getAddressDecoder,
  getBase64Decoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
} from "@solana/kit";
import { USDC_MINT_ADDRESS } from "@workspace/orchid-links";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  ExternalPayment,
  ExternalPaymentApplied,
  type ExternalPaymentSettlement,
  type ExternalPaymentTerms,
  type RequestPaymentChain,
} from "../server/chain-request-payments.server";
import {
  Expired,
  Rejected,
  Undecided,
} from "../server/chain-settlement.server";
import { rpcReadConcurrency } from "../server/settings.server";
import { ChainUnreachable } from "../server/chain-errors.server";
import { draftWindowFor } from "./draft-chain.server";
import {
  decodeEnvelope,
  decodeSealedEnvelope,
  encodeSealedEnvelope,
} from "./envelope-codec";
import { computeUnitLimits, draftExternalPayment } from "./envelope-drafts";
import { memoProgramAddress } from "./memo";
import { solanaProfile } from "./profile";
import { usdcAccountOf } from "./program-addresses";
import { type RpcRefusal, type SolanaRpc, readCommitment } from "./rpc.server";
import { SignatureError, rejectionCode } from "./settlement.server";
import {
  decodeWireTransaction,
  encodeWireTransaction,
  signersOf,
} from "./wire-transaction";

const addressDecoder = getAddressDecoder();
const base64Decoder = getBase64Decoder();
const base64Encoder = getBase64Encoder();
const messageDecoder = getCompiledTransactionMessageDecoder();
const textEncoder = new TextEncoder();

const signaturePageSize = 1000;

const anyContextSlot = 0;

const minContextSlotNotReached = -32016;

const ReferencedSignatures = Schema.Array(
  Schema.Struct({ signature: Schema.String, slot: Schema.Int }),
);

const TokenBalance = Schema.Struct({
  accountIndex: Schema.Int,
  mint: Schema.String,
  uiTokenAmount: Schema.Struct({ amount: Schema.String }),
});

const TokenBalances = Schema.optional(
  Schema.NullOr(Schema.Array(TokenBalance)),
);

const LandedTransaction = Schema.NullOr(
  Schema.Struct({
    blockTime: Schema.NullOr(Schema.Int),
    transaction: Schema.Tuple([Schema.String, Schema.Literal("base64")]),
    meta: Schema.NullOr(
      Schema.Struct({
        err: Schema.NullOr(SignatureError),
        preTokenBalances: TokenBalances,
        postTokenBalances: TokenBalances,
        loadedAddresses: Schema.optional(
          Schema.Struct({
            writable: Schema.Array(Schema.String),
            readonly: Schema.Array(Schema.String),
          }),
        ),
      }),
    ),
  }),
);

type LandedTransaction = NonNullable<typeof LandedTransaction.Type>;

const FinalizedTip = Schema.Struct({
  absoluteSlot: Schema.Int,
  blockHeight: Schema.Int,
});

const usdcUnitsAt = (
  balances: ReadonlyArray<typeof TokenBalance.Type>,
  accountIndex: number,
) =>
  Option.match(
    Arr.findFirst(
      balances,
      (balance) =>
        balance.accountIndex === accountIndex &&
        balance.mint === USDC_MINT_ADDRESS,
    ),
    {
      onNone: () => 0n,
      onSome: (balance) => BigInt(balance.uiTokenAmount.amount),
    },
  );

type Verdict = Data.TaggedEnum<{
  Paid: { readonly hash: string; readonly blockTime: number | null };
  Failed: { readonly code: string };
  Unrelated: {};
  Unverifiable: {};
}>;

const Verdict = Data.taggedEnum<Verdict>();

const verdictOf = (
  hash: string,
  landed: LandedTransaction,
  reference: Address,
  terms: ExternalPaymentTerms,
): Verdict => {
  const compiled = messageDecoder.decode(
    decodeWireTransaction(base64Encoder.encode(landed.transaction[0]))
      .messageBytes,
  );

  const signers = compiled.staticAccounts.slice(
    0,
    compiled.header.numSignerAccounts,
  );

  if (!signers.includes(reference) || compiled.version === 1)
    return Verdict.Unrelated();

  const { meta } = landed;

  if (meta === null) return Verdict.Unverifiable();

  if (meta.err !== null)
    return Verdict.Failed({ code: rejectionCode(meta.err) });

  const { preTokenBalances, postTokenBalances } = meta;

  if (
    preTokenBalances === undefined ||
    preTokenBalances === null ||
    postTokenBalances === undefined ||
    postTokenBalances === null
  )
    return Verdict.Unverifiable();

  const accounts = [
    ...compiled.staticAccounts,
    ...(meta.loadedAddresses?.writable ?? []),
    ...(meta.loadedAddresses?.readonly ?? []),
  ];

  const memo = textEncoder.encode(terms.request);

  const carriesMemo = compiled.instructions.some(
    (instruction) =>
      accounts[instruction.programAddressIndex] === memoProgramAddress &&
      instruction.data !== undefined &&
      instruction.data.length === memo.length &&
      instruction.data.every((byte, index) => byte === memo[index]),
  );

  const credited = accounts.indexOf(usdcAccountOf(address(terms.requester)));

  const received =
    credited < 0
      ? 0n
      : usdcUnitsAt(postTokenBalances, credited) -
        usdcUnitsAt(preTokenBalances, credited);

  return carriesMemo && received >= terms.amount
    ? Verdict.Paid({ hash, blockTime: landed.blockTime })
    : Verdict.Failed({ code: "terms_unmet" });
};

export const solanaRequestPayments = (rpc: SolanaRpc): RequestPaymentChain => {
  const referencedSince = (
    reference: Address,
    draftedSlot: bigint,
    minContextSlot: number,
  ) => {
    const page = (
      before: Option.Option<string>,
    ): Effect.Effect<ReadonlyArray<string>, ChainUnreachable | RpcRefusal> => {
      const newest = {
        commitment: readCommitment,
        limit: signaturePageSize,
        minContextSlot,
      };

      const options = Option.match(before, {
        onNone: () => newest,
        onSome: (signature) => ({ ...newest, before: signature }),
      });

      return rpc
        .attempt(
          "getSignaturesForAddress",
          [reference, options],
          ReferencedSignatures,
        )
        .pipe(
          Effect.flatMap((found) => {
            const recent = found.filter(
              ({ slot }) => BigInt(slot) >= draftedSlot,
            );

            const oldest = Arr.last(found);

            return found.length < signaturePageSize ||
              recent.length < found.length ||
              Option.isNone(oldest)
              ? Effect.succeed(recent.map(({ signature }) => signature))
              : Effect.map(
                  page(Option.some(oldest.value.signature)),
                  (older) => [
                    ...recent.map(({ signature }) => signature),
                    ...older,
                  ],
                );
          }),
        );
    };

    return page(Option.none()).pipe(
      Effect.map(Option.some),
      Effect.catchTag("RpcRefusal", (refusal) =>
        refusal.code === minContextSlotNotReached
          ? Effect.succeed(Option.none())
          : Effect.fail(new ChainUnreachable({ cause: refusal })),
      ),
    );
  };

  return {
    draftExternalPayment: Effect.fn("Chain.draftExternalPayment")(function* (
      terms: ExternalPaymentTerms,
    ) {
      const payer = address(terms.payer);

      const referenceSeed = yield* Effect.sync(() =>
        ed25519.utils.randomSecretKey(),
      );

      const reference = addressDecoder.decode(
        ed25519.getPublicKey(referenceSeed),
      );

      const window = yield* draftWindowFor(rpc, computeUnitLimits.payment);

      const { messageBytes, lastValidBlockHeight, draftedSlot } =
        Option.getOrThrow(
          decodeEnvelope(
            draftExternalPayment({
              ...window,
              payer,
              reference,
              destinationTokenAccount: usdcAccountOf(address(terms.requester)),
              amount: terms.amount,
              memo: { type: "text", value: terms.request },
            }),
          ),
        );

      const referenceSignature = ed25519.sign(
        new Uint8Array(messageBytes),
        referenceSeed,
      );

      const transactionBytes = encodeWireTransaction({
        signatures: signersOf(messageBytes).map((signer) =>
          signer === reference ? referenceSignature : new Uint8Array(64),
        ),
        messageBytes,
      });

      const now = yield* Clock.currentTimeMillis;

      return new ExternalPayment({
        reference,
        transaction: base64Decoder.decode(transactionBytes),
        envelope: encodeSealedEnvelope({
          lastValidBlockHeight,
          draftedSlot,
          transactionBytes,
        }),
        expiresAt: DateTime.makeUnsafe(
          (Math.floor(now / 1000) + solanaProfile.draftTiming.lifetime) * 1000,
        ),
      });
    }),
    externalPaymentSettlement: Effect.fn("Chain.externalPaymentSettlement")(
      function* (payment: ExternalPayment, terms: ExternalPaymentTerms) {
        const reference = address(payment.reference);

        const { lastValidBlockHeight, draftedSlot } = Option.getOrThrow(
          decodeSealedEnvelope(payment.envelope),
        );

        const concluded = Effect.fn("Chain.concludeExternalPayment")(function* (
          signatures: ReadonlyArray<string>,
        ): Effect.fn.Return<
          Option.Option<ExternalPaymentSettlement>,
          ChainUnreachable
        > {
          const landed = yield* Effect.forEach(
            signatures,
            (signature) =>
              rpc.call(
                "getTransaction",
                [
                  signature,
                  {
                    commitment: readCommitment,
                    encoding: "base64",
                    maxSupportedTransactionVersion: 0,
                  },
                ],
                LandedTransaction,
              ),
            { concurrency: rpcReadConcurrency },
          );

          const verdicts = Arr.zipWith(signatures, landed, (hash, found) =>
            found === null
              ? Verdict.Unverifiable()
              : verdictOf(hash, found, reference, terms),
          );

          const paid = Arr.findFirst(verdicts, Verdict.$is("Paid"));

          if (Option.isSome(paid))
            return Option.some(
              new ExternalPaymentApplied({
                hash: paid.value.hash,
                at:
                  paid.value.blockTime === null
                    ? yield* DateTime.now
                    : DateTime.makeUnsafe(paid.value.blockTime * 1000),
              }),
            );

          if (verdicts.some(Verdict.$is("Unverifiable")))
            return Option.some(new Undecided());

          return Option.map(
            Arr.findFirst(verdicts, Verdict.$is("Failed")),
            ({ code }) => new Rejected({ code }),
          );
        });

        const undecidedOr = (lookup: Option.Option<ReadonlyArray<string>>) =>
          Option.match(lookup, {
            onNone: () =>
              Effect.succeed(
                Option.some<ExternalPaymentSettlement>(new Undecided()),
              ),
            onSome: concluded,
          });

        const first = yield* undecidedOr(
          yield* referencedSince(reference, draftedSlot, anyContextSlot),
        );

        if (Option.isSome(first)) return first.value;

        const finalized = yield* rpc.call(
          "getEpochInfo",
          [{ commitment: "finalized" }],
          FinalizedTip,
        );

        if (BigInt(finalized.blockHeight) <= lastValidBlockHeight)
          return new Undecided();

        const byThen = yield* undecidedOr(
          yield* referencedSince(
            reference,
            draftedSlot,
            finalized.absoluteSlot,
          ),
        );

        if (Option.isSome(byThen)) return byThen.value;

        const firstAvailableBlock = yield* rpc.call(
          "getFirstAvailableBlock",
          [],
          Schema.Int,
        );

        return BigInt(firstAvailableBlock) > draftedSlot
          ? new Undecided()
          : new Expired();
      },
    ),
  };
};
