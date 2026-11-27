import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type { DeviceNetwork, DraftFacts } from "../device-network";
import { isIssuedBy } from "./assets";
import { baseAccountOf } from "./destination";
import { type EnvelopeFacts, readEnvelope } from "./envelopes";
import { network } from "./network";
import { stellarSigningScheme } from "./signing-scheme";

const channelIsAParty = (facts: EnvelopeFacts) =>
  (Predicate.isTagged(facts, "OpeningFacts") &&
    facts.channel === facts.address) ||
  (Predicate.isTagged(facts, "LinkReceiveFacts") &&
    (facts.channel === facts.link ||
      facts.channel === baseAccountOf(facts.destination)));

const reviewedFacts = (facts: EnvelopeFacts): Option.Option<DraftFacts> =>
  Predicate.isTagged(facts, "TrustlineFacts") ||
  Predicate.isTagged(facts, "TrustlineRemovalFacts") ||
  channelIsAParty(facts)
    ? Option.none()
    : Option.some(facts);

export const stellarDeviceNetwork: DeviceNetwork = {
  network,
  signingScheme: stellarSigningScheme,
  readDraft: (request) =>
    Option.flatMap(readEnvelope(request.envelope), reviewedFacts),
  baseAccountOf,
  creditedAccountOf: (destination) => destination,
  isIssuedBy,
};
