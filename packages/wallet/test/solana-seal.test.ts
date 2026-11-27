import { expect, it } from "@effect/vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { blockhash, getAddressDecoder } from "@solana/kit";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Approval, PositiveAmount, SigningRequest } from "../src/contract";
import { draftPayment } from "../src/solana/envelope-drafts";
import { usdcAccountOf } from "../src/solana/program-addresses";
import { SolanaAccountAddress } from "../src/solana/schemas";
import { solanaSeal, solanaSponsor } from "../src/solana/seal.server";
import { solanaSigningScheme } from "../src/solana/signing-scheme";

const addressDecoder = getAddressDecoder();

const keyOf = (byte: number) => {
  const seed = new Uint8Array(32).fill(byte);
  const publicKey = ed25519.getPublicKey(seed);

  return { seed, publicKey, address: addressDecoder.decode(publicKey) };
};

const sponsorKey = keyOf(1);
const holder = keyOf(2);
const stranger = keyOf(3);
const recipient = keyOf(4);

const sponsor = solanaSponsor(
  concatBytes(sponsorKey.seed, sponsorKey.publicKey),
);

const request = new SigningRequest({
  envelope: draftPayment({
    sponsor: sponsor.address,
    blockhash: blockhash(addressDecoder.decode(new Uint8Array(32).fill(7))),
    lastValidBlockHeight: 4_000_000_000n,
    draftedSlot: 4_100_000_000n,
    computeUnitPrice: 0n,
    from: holder.address,
    destinationTokenAccount: usdcAccountOf(recipient.address),
    amount: Schema.decodeSync(PositiveAmount)("5500001"),
  }),
  expiresAt: DateTime.makeUnsafe(60_000),
});

const signedBy = (key: ReturnType<typeof keyOf>) =>
  new Approval({
    signature: ed25519.sign(
      solanaSigningScheme.signingPayload(request.envelope),
      key.seed,
    ),
  });

it.effect.each([
  {
    name: "seals a payment its holder approved",
    approval: signedBy(holder),
    claimedHolder: holder.address,
    outcome: "Sealed",
  },
  {
    name: "refuses an approval signed by another key",
    approval: signedBy(stranger),
    claimedHolder: holder.address,
    outcome: "ApprovalInvalid",
  },
  {
    name: "refuses a holder who is not the payer",
    approval: signedBy(stranger),
    claimedHolder: stranger.address,
    outcome: "ApprovalInvalid",
  },
])("$name", ({ approval, claimedHolder, outcome }) =>
  Effect.gen(function* () {
    const sealed = yield* solanaSeal(sponsor)(
      request,
      approval,
      Schema.decodeSync(SolanaAccountAddress)(claimedHolder),
    ).pipe(
      Effect.match({
        onFailure: (failure) => failure._tag,
        onSuccess: () => "Sealed",
      }),
    );

    expect(sealed).toBe(outcome);
  }),
);
