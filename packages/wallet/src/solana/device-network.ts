import { type Address, address } from "@solana/kit";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  DestinationAddress,
  type SigningRequest,
  UnclaimedFundsId,
  baseAsset,
} from "../contract";
import type { DeviceNetwork } from "../device-network";
import { DraftFacts } from "../draft-facts";
import { decodeEnvelope } from "./envelope-codec";
import { EnvelopeFacts, readEnvelope } from "./envelopes";
import { network } from "./network";
import { usdcAccountOf } from "./program-addresses";
import { solanaSigningScheme } from "./signing-scheme";
import { signersOf } from "./wire-transaction";

const accountOf = Schema.decodeSync(AccountAddress);
const destinationOf = Schema.decodeSync(DestinationAddress);
const unclaimedFundsOf = Schema.decodeSync(UnclaimedFundsId);

const feePayerOf = (request: SigningRequest) =>
  Option.flatMap(decodeEnvelope(request.envelope), ({ messageBytes }) =>
    Option.fromUndefinedOr(signersOf(messageBytes)[0]),
  );

const draftFactsOf = (facts: EnvelopeFacts, maxTime: number): DraftFacts => {
  const reserveSponsor = accountOf(facts.sponsor);

  return EnvelopeFacts.$match(facts, {
    OpeningFacts: ({ address: opened }): DraftFacts =>
      DraftFacts.OpeningFacts({
        address: accountOf(opened),
        reserveSponsor,
        maxTime,
      }),
    PaymentFacts: ({
      from,
      destinationTokenAccount,
      amount,
      memo,
    }): DraftFacts =>
      DraftFacts.PaymentFacts({
        from: accountOf(from),
        to: destinationOf(destinationTokenAccount),
        asset: baseAsset,
        amount,
        memo,
        maxTime,
      }),
    PaymentLinkFacts: ({ from, link, amount, unclaimedFunds }): DraftFacts =>
      DraftFacts.PaymentLinkFacts({
        from: accountOf(from),
        to: accountOf(link),
        reserveSponsor,
        unclaimedFunds: unclaimedFundsOf(unclaimedFunds),
        asset: baseAsset,
        amount,
        maxTime,
      }),
    LinkReceiveFacts: ({
      link,
      unclaimedFunds,
      destinationTokenAccount,
      memo,
    }): DraftFacts =>
      DraftFacts.LinkReceiveFacts({
        link: accountOf(link),
        reserveSponsor,
        destination: destinationOf(destinationTokenAccount),
        unclaimedFunds: unclaimedFundsOf(unclaimedFunds),
        asset: baseAsset,
        memo,
        maxTime,
      }),
    ReclaimFacts: ({ address: owner, unclaimedFunds }): DraftFacts =>
      DraftFacts.ClaimFacts({
        address: accountOf(owner),
        unclaimedFunds: unclaimedFundsOf(unclaimedFunds),
        maxTime,
      }),
  });
};

const readDraft = (request: SigningRequest) =>
  Option.flatMap(feePayerOf(request), (sponsor: Address) =>
    Option.flatMap(readEnvelope(request.envelope, sponsor), (facts) =>
      Option.liftThrowable(draftFactsOf)(
        facts,
        Math.floor(DateTime.toEpochMillis(request.expiresAt) / 1000),
      ),
    ),
  );

export const solanaDeviceNetwork: DeviceNetwork = {
  network,
  signingScheme: solanaSigningScheme,
  readDraft,
  baseAccountOf: accountOf,
  creditedAccountOf: (destination) =>
    destinationOf(usdcAccountOf(address(destination))),
  isIssuedBy: () => false,
};
