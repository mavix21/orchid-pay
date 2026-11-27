import type { Account } from "@stellar/stellar-sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import {
  type AccountAddress,
  type SigningRequest,
  sameAsset,
} from "../contract";
import type { AssetPlan } from "../server/asset-plan.server";
import { type DraftChain, DraftPurpose } from "../server/chain-drafts.server";
import type { ChainUnreachable } from "../server/chain-errors.server";
import type { PreparedLinkReceive } from "../server/chain-links.server";
import { claimableBalanceOf } from "./asset-envelopes";
import { plannedSequence } from "./asset-plans";
import { readEnvelope } from "./envelopes";
import type { AccountState } from "./ledger.server";
import { sameMemo } from "./memo";

type SequenceNumber = ReturnType<Account["sequenceNumber"]>;

export const draftChain = (
  account: (
    address: AccountAddress,
  ) => Effect.Effect<Option.Option<AccountState>, ChainUnreachable>,
): DraftChain => {
  const follows = (
    source: Option.Option<AccountState>,
    sequence: SequenceNumber,
  ) =>
    Option.exists(
      source,
      (state) => BigInt(state.sequence) + 1n === BigInt(sequence),
    );

  const transferCurrent = Effect.fn("Chain.transferDraftCurrent")(function* (
    request: SigningRequest,
    from: AccountAddress,
  ) {
    const source = yield* account(from);

    return Option.exists(
      readEnvelope(request.envelope),
      (facts) =>
        (Predicate.isTagged(facts, "PaymentFacts") ||
          Predicate.isTagged(facts, "ClaimableFacts") ||
          Predicate.isTagged(facts, "PaymentLinkFacts")) &&
        follows(source, facts.sequence),
    );
  });

  const assetCurrent = Effect.fn("Chain.assetDraftCurrent")(function* (
    request: SigningRequest,
    address: AccountAddress,
    plan: AssetPlan,
  ) {
    const source = yield* account(address);

    return Option.exists(plannedSequence(request.envelope, plan), (sequence) =>
      follows(source, sequence),
    );
  });

  const linkReceiveCurrent = Effect.fn("Chain.linkReceiveDraftCurrent")(
    function* (request: SigningRequest, receive: PreparedLinkReceive) {
      const facts = readEnvelope(request.envelope);

      if (
        Option.isNone(facts) ||
        !Predicate.isTagged(facts.value, "LinkReceiveFacts")
      )
        return false;

      const channel = yield* account(facts.value.channel);

      return (
        facts.value.createsLinkAccount === receive.createsLinkAccount &&
        facts.value.link === receive.link &&
        facts.value.unclaimedFunds === receive.unclaimedFunds &&
        facts.value.destination === receive.destination &&
        sameMemo(facts.value.memo, receive.memo) &&
        sameAsset(facts.value.asset, receive.asset) &&
        facts.value.amount === receive.amount &&
        follows(channel, facts.value.sequence)
      );
    },
  );

  return {
    unclaimedFundsCreatedBy: (request) => claimableBalanceOf(request.envelope),
    draftCurrent: (request, purpose) =>
      DraftPurpose.$match(purpose, {
        Transfer: ({ from }) => transferCurrent(request, from),
        AssetChange: ({ address, plan }) =>
          assetCurrent(request, address, plan),
        LinkReceive: ({ receive }) => linkReceiveCurrent(request, receive),
      }),
  };
};
