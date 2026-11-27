import { ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getBase58Decoder } from "@solana/kit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AccountAddress } from "../contract";
import type { SigningScheme } from "../device/signing-scheme";
import { decodeEnvelope } from "./envelope-codec";
import { chainId } from "./network";

const encoder = new TextEncoder();
const linkKeySalt = encoder.encode("orchid-payment-link-code-v1");
const linkKeyInfo = encoder.encode(chainId);
const base58Decoder = getBase58Decoder();

export const base58AddressOf = (publicKey: Uint8Array) =>
  base58Decoder.decode(publicKey);

const address = (publicKey: Uint8Array) =>
  Schema.decodeSync(AccountAddress)(base58AddressOf(publicKey));

export const solanaSigningScheme: SigningScheme = {
  derivationPath: "m/44'/501'/0'/0'",
  address,
  withLinkKey: (entropy, use) => {
    const seed = hkdf(sha256, entropy, linkKeySalt, linkKeyInfo, 32);

    try {
      return use({
        address: address(ed25519.getPublicKey(seed)),
        sign: (payload) => ed25519.sign(payload, seed),
      });
    } finally {
      seed.fill(0);
    }
  },
  signingPayload: (envelope) =>
    new Uint8Array(Option.getOrThrow(decodeEnvelope(envelope)).messageBytes),
};
