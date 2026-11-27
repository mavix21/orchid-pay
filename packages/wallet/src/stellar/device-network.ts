import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type { DeviceNetwork, DraftFacts } from "../device-network";
import { isIssuedBy } from "./assets";
import { baseAccountOf } from "./destination";
import { type EnvelopeFacts, readEnvelope } from "./envelopes";
import { network } from "./network";
import { stellarSigningScheme } from "./signing-scheme";

const reviewedFacts = (facts: EnvelopeFacts): Option.Option<DraftFacts> =>
  Predicate.isTagged(facts, "TrustlineFacts") ||
  Predicate.isTagged(facts, "TrustlineRemovalFacts")
    ? Option.none()
    : Option.some(facts);

export const stellarDeviceNetwork: DeviceNetwork = {
  network,
  signingScheme: stellarSigningScheme,
  readDraft: (request) =>
    Option.flatMap(readEnvelope(request.envelope), reviewedFacts),
  baseAccountOf,
  isIssuedBy,
};
