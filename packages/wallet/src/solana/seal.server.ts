import { ed25519 } from "@noble/curves/ed25519.js";
import { equalBytes } from "@noble/curves/utils.js";
import {
  type Address,
  type ReadonlyUint8Array,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase58Decoder,
} from "@solana/kit";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { AccountAddress, Approval, SigningRequest } from "../contract";
import { ApprovalInvalid, Sealed } from "../server/Chain.server";
import { decodeEnvelope, encodeSealedEnvelope } from "./envelope-codec";
import { EnvelopeFacts, readEnvelope } from "./envelopes";
import { solanaProfile } from "./profile";
import { encodeWireTransaction, signersOf } from "./wire-transaction";

export interface SolanaSponsor {
  readonly address: Address;
  sign(message: ReadonlyUint8Array): Uint8Array;
}

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();
const base58Decoder = getBase58Decoder();

export const solanaSponsor = (keypair: Uint8Array): SolanaSponsor => {
  const seed = keypair.slice(0, 32);

  if (keypair.length !== 64)
    throw new RangeError("The sponsor keypair is not a Solana keypair");

  const publicKey = ed25519.getPublicKey(seed);

  if (!equalBytes(publicKey, keypair.slice(32)))
    throw new RangeError("The sponsor keypair is not a Solana keypair");

  return {
    address: addressDecoder.decode(publicKey),
    sign: (message) => ed25519.sign(new Uint8Array(message), seed),
  };
};

const permittedFor = (holder: Address) =>
  EnvelopeFacts.$match({
    OpeningFacts: (facts) => facts.address === holder,
    PaymentFacts: (facts) => facts.from === holder,
    PaymentLinkFacts: (facts) => facts.from === holder && facts.link !== holder,
    LinkReceiveFacts: (facts) => facts.link === holder,
    ReclaimFacts: (facts) => facts.address === holder,
  });

const signedOnlyBy = (
  messageBytes: ReadonlyUint8Array,
  sponsor: Address,
  holder: Address,
) => {
  const signers = signersOf(messageBytes);

  return (
    signers.length === 2 && signers[0] === sponsor && signers[1] === holder
  );
};

const approvedBy = (
  holder: Address,
  signature: Uint8Array,
  messageBytes: ReadonlyUint8Array,
) =>
  Option.liftThrowable(() =>
    ed25519.verify(
      signature,
      new Uint8Array(messageBytes),
      new Uint8Array(addressEncoder.encode(holder)),
      { zip215: false },
    ),
  )().pipe(Option.getOrElse(() => false));

const sealedBy = (
  sponsor: SolanaSponsor,
  request: SigningRequest,
  approval: Approval,
  holder: Address,
  now: number,
): Option.Option<Sealed> => {
  const envelope = decodeEnvelope(request.envelope);
  const facts = readEnvelope(request.envelope, sponsor.address);

  if (Option.isNone(envelope) || Option.isNone(facts)) return Option.none();

  const { messageBytes, lastValidBlockHeight, draftedSlot } = envelope.value;

  const fresh =
    DateTime.toEpochMillis(request.expiresAt) >=
    now + solanaProfile.draftTiming.approvalMargin * 1000;

  if (
    !permittedFor(holder)(facts.value) ||
    !signedOnlyBy(messageBytes, sponsor.address, holder) ||
    !fresh ||
    !approvedBy(holder, approval.signature, messageBytes)
  )
    return Option.none();

  const sponsorSignature = sponsor.sign(messageBytes);

  return Option.some(
    new Sealed({
      envelope: encodeSealedEnvelope({
        lastValidBlockHeight,
        draftedSlot,
        transactionBytes: encodeWireTransaction({
          signatures: [sponsorSignature, approval.signature],
          messageBytes,
        }),
      }),
      hash: base58Decoder.decode(sponsorSignature),
      expiresAt: request.expiresAt,
    }),
  );
};

export const solanaSeal =
  (sponsor: SolanaSponsor) =>
  (
    request: SigningRequest,
    approval: Approval,
    holder: AccountAddress,
  ): Effect.Effect<Sealed, ApprovalInvalid> =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;

      const sealed = Option.flatMap(
        Option.liftThrowable(address)(holder),
        (signer) => sealedBy(sponsor, request, approval, signer, now),
      );

      return Option.isSome(sealed)
        ? sealed.value
        : yield* new ApprovalInvalid();
    }).pipe(Effect.withSpan("Chain.seal"));
