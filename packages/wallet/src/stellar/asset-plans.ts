import * as Predicate from "effect/Predicate";
import type { Account } from "@stellar/stellar-sdk";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import {
  type AccountAddress,
  type Asset,
  type UnsignedEnvelope,
  sameAsset,
} from "../contract";
import {
  draftClaim,
  draftTrustline,
  draftTrustlineRemoval,
} from "./asset-envelopes";
import type { AssetPlan } from "../server/asset-plan.server";
import { readEnvelope } from "./envelopes";

export interface PlanInput {
  readonly source: Account;
  readonly minTime: number;
  readonly maxTime: number;
  readonly reserveSponsor: AccountAddress;
}

export function draftPlan(plan: AssetPlan, input: PlanInput): UnsignedEnvelope {
  const { reserveSponsor, ...drafting } = input;

  return Match.valueTags(plan, {
    OpenTrustline: ({ asset }) =>
      draftTrustline({ ...drafting, reserveSponsor, asset }),
    CloseTrustline: ({ asset }) =>
      draftTrustlineRemoval({ ...drafting, asset }),
    ClaimPlan: ({ unclaimedFunds, opens }) =>
      opens
        ? draftClaim({
            ...drafting,
            unclaimedFunds,
            opens: { asset: opens, reserveSponsor },
          })
        : draftClaim({ ...drafting, unclaimedFunds }),
  });
}

const sameOpening = (drafted?: Asset, planned?: Asset) =>
  drafted && planned ? sameAsset(drafted, planned) : drafted === planned;

export function plannedSequence(
  envelope: UnsignedEnvelope,
  plan: AssetPlan,
): Option.Option<string> {
  return readEnvelope(envelope).pipe(
    Option.filter((facts) =>
      Match.valueTags(plan, {
        OpenTrustline: ({ asset }) =>
          Predicate.isTagged(facts, "TrustlineFacts") &&
          sameAsset(facts.asset, asset),
        CloseTrustline: ({ asset }) =>
          Predicate.isTagged(facts, "TrustlineRemovalFacts") &&
          sameAsset(facts.asset, asset),
        ClaimPlan: ({ unclaimedFunds, opens }) =>
          Predicate.isTagged(facts, "ClaimFacts") &&
          facts.unclaimedFunds === unclaimedFunds &&
          sameOpening(facts.opens, opens),
      }),
    ),
    Option.map((facts) => facts.sequence),
  );
}
