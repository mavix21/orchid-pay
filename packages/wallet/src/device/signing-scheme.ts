import type { AccountAddress, UnsignedEnvelope } from "../contract";

export interface LinkKey {
  readonly address: AccountAddress;
  readonly sign: (payload: Uint8Array) => Uint8Array;
}

export interface SigningScheme {
  readonly derivationPath: string;
  readonly address: (publicKey: Uint8Array) => AccountAddress;
  readonly withLinkKey: <A>(entropy: Uint8Array, use: (key: LinkKey) => A) => A;
  readonly signingPayload: (envelope: UnsignedEnvelope) => Uint8Array;
}
