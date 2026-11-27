import { type Address, address, blockhash } from "@solana/kit";
import * as Arr from "effect/Array";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  type Asset,
  type DestinationAddress,
  OpeningDraft,
  type PaymentMemo,
  type PositiveAmount,
  SigningRequest,
  type UnsignedEnvelope,
} from "../contract";
import type { AssetPlan } from "../server/asset-plan.server";
import { DraftPurpose } from "../server/chain-drafts.server";
import { rpcReadConcurrency } from "../server/settings.server";
import type {
  LinkReceive,
  PreparedLinkReceive,
} from "../server/chain-links.server";
import type { Sealed } from "../server/chain-settlement.server";
import { decodeSealedEnvelope } from "./envelope-codec";
import {
  type Drafting,
  computeUnitLimits,
  draftLinkReceive,
  draftOpening,
  draftPayment,
  draftPaymentLink,
  draftReclaim,
} from "./envelope-drafts";
import {
  type EnvelopeFacts,
  maxPriorityFeeLamports,
  readEnvelope,
} from "./envelopes";
import { textMemoOf } from "./memo";
import { solanaProfile } from "./profile";
import { usdcAccountOf } from "./program-addresses";
import { type SolanaRpc, inContext, preflightCommitment } from "./rpc.server";
import { SolanaUnclaimedFundsId } from "./schemas";

const LatestBlockhash = inContext(
  Schema.Struct({ blockhash: Schema.String, lastValidBlockHeight: Schema.Int }),
);

const RecentPrioritizationFees = Schema.Array(
  Schema.Struct({ prioritizationFee: Schema.Int }),
);

const orderIdLength = 16;

const highestComputeUnitPrice = (computeUnitLimit: number) =>
  (maxPriorityFeeLamports * 1_000_000n) / BigInt(computeUnitLimit);

const medianOf = (fees: ReadonlyArray<bigint>) =>
  Option.getOrElse(
    Arr.get(Arr.sort(fees, Order.BigInt), Math.floor(fees.length / 2)),
    () => 0n,
  );

const usdcOnly = (asset: Asset) => {
  if (asset.id !== solanaProfile.baseAsset.id)
    throw new RangeError("A Solana draft moves only USDC");
};

const sameLinkReceive = (facts: EnvelopeFacts, receive: PreparedLinkReceive) =>
  Predicate.isTagged(facts, "LinkReceiveFacts") &&
  facts.link === address(receive.link) &&
  facts.unclaimedFunds === address(receive.unclaimedFunds) &&
  facts.destinationTokenAccount ===
    usdcAccountOf(address(receive.destination)) &&
  facts.memo?.value === textMemoOf(receive.memo)?.value;

const plannedReclaim = (
  facts: EnvelopeFacts,
  owner: AccountAddress,
  plan: AssetPlan,
) =>
  Predicate.isTagged(plan, "ClaimPlan") &&
  plan.opens === undefined &&
  Predicate.isTagged(facts, "ReclaimFacts") &&
  facts.address === address(owner) &&
  facts.unclaimedFunds === address(plan.unclaimedFunds);

const transferFrom = (facts: EnvelopeFacts, from: AccountAddress) =>
  (Predicate.isTagged(facts, "PaymentFacts") ||
    Predicate.isTagged(facts, "PaymentLinkFacts")) &&
  facts.from === address(from);

export const solanaDraftChain = (rpc: SolanaRpc, sponsor: Address) => {
  const drafting = Effect.fn("Chain.drafting")(function* (
    computeUnitLimit: number,
  ) {
    const [latest, fees] = yield* Effect.all(
      [
        rpc.call(
          "getLatestBlockhash",
          [{ commitment: preflightCommitment }],
          LatestBlockhash,
        ),
        rpc.call("getRecentPrioritizationFees", [], RecentPrioritizationFees),
      ],
      { concurrency: rpcReadConcurrency },
    );

    const recentPrice = medianOf(
      fees.map(({ prioritizationFee }) => BigInt(prioritizationFee)),
    );

    const highestPrice = highestComputeUnitPrice(computeUnitLimit);

    return {
      sponsor,
      blockhash: blockhash(latest.value.blockhash),
      lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight),
      draftedSlot: BigInt(latest.context.slot),
      computeUnitPrice: recentPrice < highestPrice ? recentPrice : highestPrice,
    } satisfies Drafting;
  });

  const requestFor = (envelope: UnsignedEnvelope) =>
    Effect.map(
      Clock.currentTimeMillis,
      (now) =>
        new SigningRequest({
          envelope,
          expiresAt: DateTime.makeUnsafe(
            now + solanaProfile.draftTiming.lifetime * 1000,
          ),
        }),
    );

  const blockHeight = (commitment: string) =>
    rpc
      .call("getBlockHeight", [{ commitment }], Schema.Int)
      .pipe(Effect.map(BigInt));

  const stillLands = (facts: EnvelopeFacts) =>
    blockHeight(preflightCommitment).pipe(
      Effect.map((height) => height <= facts.lastValidBlockHeight),
    );

  return {
    draftOpening: Effect.fn("Chain.draftOpening")(function* (
      owner: AccountAddress,
    ) {
      const current = yield* drafting(computeUnitLimits.opening);

      return new OpeningDraft({
        request: yield* requestFor(
          draftOpening({ ...current, address: address(owner) }),
        ),
      });
    }),
    draftPayment: Effect.fn("Chain.draftPayment")(function* (
      from: AccountAddress,
      to: DestinationAddress,
      asset: Asset,
      amount: PositiveAmount,
      memo?: PaymentMemo,
    ) {
      usdcOnly(asset);

      const current = yield* drafting(computeUnitLimits.payment);

      return yield* requestFor(
        draftPayment({
          ...current,
          from: address(from),
          destinationTokenAccount: usdcAccountOf(address(to)),
          amount,
          memo: textMemoOf(memo),
        }),
      );
    }),
    draftPaymentLink: Effect.fn("Chain.draftPaymentLink")(function* (
      from: AccountAddress,
      link: AccountAddress,
      asset: Asset,
      amount: PositiveAmount,
    ) {
      usdcOnly(asset);

      const current = yield* drafting(computeUnitLimits.paymentLink);

      const orderId = yield* Effect.sync(() =>
        crypto.getRandomValues(new Uint8Array(orderIdLength)),
      );

      return yield* requestFor(
        draftPaymentLink({
          ...current,
          from: address(from),
          link: address(link),
          orderId,
          amount,
        }),
      );
    }),
    draftAsset: Effect.fn("Chain.draftAsset")(function* (
      owner: AccountAddress,
      plan: AssetPlan,
    ) {
      if (!Predicate.isTagged(plan, "ClaimPlan") || plan.opens !== undefined)
        return yield* Effect.die(
          new RangeError("A Solana wallet changes no assets but a reclaim"),
        );

      const current = yield* drafting(computeUnitLimits.reclaim);

      return yield* requestFor(
        draftReclaim({
          ...current,
          address: address(owner),
          unclaimedFunds: address(plan.unclaimedFunds),
        }),
      );
    }),
    prepareLinkReceive: (receive: LinkReceive) =>
      Effect.succeed<PreparedLinkReceive>({
        ...receive,
        createsLinkAccount: false,
      }),
    draftLinkReceive: Effect.fn("Chain.draftLinkReceive")(function* (
      receive: PreparedLinkReceive,
    ) {
      usdcOnly(receive.asset);

      const current = yield* drafting(computeUnitLimits.linkReceive);

      return yield* requestFor(
        draftLinkReceive({
          ...current,
          link: address(receive.link),
          unclaimedFunds: address(receive.unclaimedFunds),
          destinationTokenAccount: usdcAccountOf(address(receive.destination)),
          memo: textMemoOf(receive.memo),
        }),
      );
    }),
    cleanUpLink: () => Effect.succeed(true),
    draftCurrent: (request: SigningRequest, purpose: DraftPurpose) => {
      const facts = readEnvelope(request.envelope, sponsor);

      const intended = Option.exists(facts, (read) =>
        DraftPurpose.$match(purpose, {
          Transfer: ({ from }) => transferFrom(read, from),
          AssetChange: ({ address: owner, plan }) =>
            plannedReclaim(read, owner, plan),
          LinkReceive: ({ receive }) => sameLinkReceive(read, receive),
        }),
      );

      return intended && Option.isSome(facts)
        ? stillLands(facts.value)
        : Effect.succeed(false);
    },
    unclaimedFundsCreatedBy: (request: SigningRequest) =>
      readEnvelope(request.envelope, sponsor).pipe(
        Option.flatMap((facts) =>
          Predicate.isTagged(facts, "PaymentLinkFacts")
            ? Option.some(
                Schema.decodeSync(SolanaUnclaimedFundsId)(facts.unclaimedFunds),
              )
            : Option.none(),
        ),
      ),
    pastOpeningWindow: Effect.fn("Chain.pastOpeningWindow")(function* (
      sealed: Sealed,
    ) {
      const { lastValidBlockHeight } = Option.getOrThrow(
        decodeSealedEnvelope(sealed.envelope),
      );

      return (yield* blockHeight("finalized")) > lastValidBlockHeight;
    }),
  };
};
