import { ed25519 } from "@noble/curves/ed25519.js";
import * as Schema from "effect/Schema";
import { AccountAddress } from "../src/contract";
import { signingScheme } from "../src/device-network";

export interface TestKey {
  publicKey(): string;
  sign(payload: Uint8Array): Uint8Array;
}

interface SeededKey extends TestKey {
  publicKey(): AccountAddress;
  readonly privateKey: Uint8Array;
}

const publicKeys = new Map<string, Uint8Array>();

export const keyFromSeed = (privateKey: Uint8Array): SeededKey => {
  const publicKey = ed25519.getPublicKey(privateKey);
  const address = signingScheme.address(publicKey);

  publicKeys.set(address, publicKey);

  return {
    privateKey,
    publicKey: () => address,
    sign: (payload) => ed25519.sign(payload, privateKey),
  };
};

export const randomKey = () => keyFromSeed(ed25519.utils.randomSecretKey());

export const randomAddress = () => randomKey().publicKey();

export const signedBy = (
  address: AccountAddress,
  payload: Uint8Array,
  signature: Uint8Array,
) => {
  const publicKey = publicKeys.get(address);

  return (
    publicKey !== undefined && ed25519.verify(signature, payload, publicKey)
  );
};

export const addressOf = (key: Pick<TestKey, "publicKey">) =>
  Schema.decodeSync(AccountAddress)(key.publicKey());
