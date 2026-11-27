import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { AccountAddress } from "../contract";
import { signingScheme } from "../device-network";
import type { LinkKey } from "./signing-scheme";

const linkCodeVersion = 1;
const linkCodeEntropyLength = 16;
const linkCodeChecksumLength = 2;
const linkCodeByteLength = 1 + linkCodeEntropyLength + linkCodeChecksumLength;
const linkCodeTextLength = 25;

const linkCodeChecksum = (body: Uint8Array) =>
  sha256(body).subarray(0, linkCodeChecksumLength);

const sameChecksum = (bytes: Uint8Array) =>
  linkCodeChecksum(bytes.subarray(0, -linkCodeChecksumLength)).every(
    (byte, index) =>
      byte === bytes[linkCodeByteLength - linkCodeChecksumLength + index],
  );

const decodeBase58 = Option.liftThrowable(base58.decode);

const linkCodeEntropy = (text: string): Option.Option<Uint8Array> =>
  Option.some(text).pipe(
    Option.filter((candidate) => candidate.length === linkCodeTextLength),
    Option.flatMap(decodeBase58),
    Option.filter(
      (bytes) =>
        bytes.length === linkCodeByteLength &&
        bytes[0] === linkCodeVersion &&
        sameChecksum(bytes) &&
        base58.encode(bytes) === text,
    ),
    Option.map((bytes) => {
      const entropy = bytes.slice(1, 1 + linkCodeEntropyLength);

      bytes.fill(0);

      return entropy;
    }),
  );

export const LinkCode = Schema.String.check(
  Schema.makeFilter((text) => Option.isSome(linkCodeEntropy(text))),
).pipe(Schema.brand("LinkCode"));

export type LinkCode = typeof LinkCode.Type;

export const withLinkKey = <A>(
  code: LinkCode,
  use: (key: LinkKey) => A,
): Option.Option<A> =>
  Option.map(linkCodeEntropy(code), (entropy) => {
    try {
      return signingScheme.withLinkKey(entropy, use);
    } finally {
      entropy.fill(0);
    }
  });

export const linkAddressOf = (code: LinkCode) =>
  withLinkKey(code, (key) => key.address);

export const opensLink = (code: LinkCode, link: AccountAddress) =>
  Option.contains(linkAddressOf(code), link);

export const generateLinkCode = (): LinkCode => {
  const body = new Uint8Array(1 + linkCodeEntropyLength);

  body[0] = linkCodeVersion;
  crypto.getRandomValues(body.subarray(1));

  const bytes = Uint8Array.of(...body, ...linkCodeChecksum(body));

  try {
    return Schema.decodeSync(LinkCode)(base58.encode(bytes));
  } finally {
    body.fill(0);
    bytes.fill(0);
  }
};

export const linkPath = (code: LinkCode) => `/r#${code}`;

export interface ReadLinkCode {
  readonly code: LinkCode;
  readonly link: AccountAddress;
}

export const readLinkCode = (fragment: string): Option.Option<ReadLinkCode> =>
  Option.flatMap(Schema.decodeUnknownOption(LinkCode)(fragment), (code) =>
    Option.map(linkAddressOf(code), (link) => ({ code, link })),
  );
