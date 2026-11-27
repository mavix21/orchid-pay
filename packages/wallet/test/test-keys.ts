import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AccountAddress, UnclaimedFundsId } from "../src/contract";
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

export const randomUnclaimedFundsId = (): UnclaimedFundsId =>
  Option.getOrElse(
    Schema.decodeUnknownOption(UnclaimedFundsId)(
      base58.encode(crypto.getRandomValues(new Uint8Array(32))),
    ),
    randomUnclaimedFundsId,
  );
