import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { getBase58Encoder } from "@solana/kit";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { AccountAddress } from "../contract";
import { isSolanaKeypair } from "./seal.server";
import { base58AddressOf } from "./signing-scheme";

const base58Encoder = getBase58Encoder();

const sandboxPartnerDomain = new TextEncoder().encode(
  "orchid sandbox payout partner",
);

const decodeKeypair = Option.liftThrowable(
  (text: string) => new Uint8Array(base58Encoder.encode(text)),
);

export const sponsorKeypairOf = (secret: Redacted.Redacted<string>) =>
  Option.getOrThrowWith(
    Option.filter(decodeKeypair(Redacted.value(secret)), isSolanaKeypair),
    () => new RangeError("The sponsor secret is not a base58 Solana keypair"),
  );

export const sandboxPartnerSeedOf = (sponsorKeypair: Uint8Array) =>
  sha256(concatBytes(sponsorKeypair.slice(0, 32), sandboxPartnerDomain));

export const solanaSandboxDepositAddress = ({
  sponsorSecret,
}: {
  readonly sponsorSecret: Redacted.Redacted<string>;
}): AccountAddress =>
  Schema.decodeSync(AccountAddress)(
    base58AddressOf(
      ed25519.getPublicKey(
        sandboxPartnerSeedOf(sponsorKeypairOf(sponsorSecret)),
      ),
    ),
  );
