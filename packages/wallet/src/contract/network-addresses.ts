import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { bech32, bech32m, createBase58check } from "@scure/base";
import * as Data from "effect/Data";
import * as Option from "effect/Option";
import { addressRules } from "../address-rules";

export type OtherAddressNetwork = "evm" | "tron" | "bitcoin";

export type RecognisedAddress = Data.TaggedEnum<{
  WalletNetworkAddress: {};
  OtherNetworkAddress: { readonly network: OtherAddressNetwork };
}>;

export const RecognisedAddress = Data.taggedEnum<RecognisedAddress>();

const decodeBase58Check = Option.liftThrowable(
  createBase58check(sha256).decode,
);

const decodeBech32 = Option.liftThrowable(bech32.decode);

const decodeBech32m = Option.liftThrowable(bech32m.decode);

const wordsToBytes = Option.liftThrowable(bech32.fromWords);

const isEvm = (address: string) => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;

  const digits = address.slice(2);

  if (digits === digits.toLowerCase() || digits === digits.toUpperCase())
    return true;

  const hash = bytesToHex(
    keccak_256(new TextEncoder().encode(digits.toLowerCase())),
  );

  return [...digits].every(
    (digit, index) =>
      (Number.parseInt(hash.charAt(index), 16) >= 8
        ? digit.toUpperCase()
        : digit.toLowerCase()) === digit,
  );
};

const isTron = (address: string) =>
  decodeBase58Check(address).pipe(
    Option.exists((bytes) => bytes.length === 21 && bytes[0] === 0x41),
  );

const isLegacyBitcoin = (address: string) =>
  decodeBase58Check(address).pipe(
    Option.exists(
      (bytes) =>
        bytes.length === 21 && (bytes[0] === 0x00 || bytes[0] === 0x05),
    ),
  );

const hasWitnessProgram = (
  decoded: Option.Option<{ prefix: string; words: Array<number> }>,
  hasVersion: (version: number) => boolean,
  hasProgramLength: (length: number) => boolean,
) =>
  Option.exists(decoded, ({ prefix, words }) => {
    const [version = -1, ...program] = words;

    return (
      prefix === "bc" &&
      hasVersion(version) &&
      Option.exists(wordsToBytes(program), ({ length }) =>
        hasProgramLength(length),
      )
    );
  });

const isSegwitBitcoin = (address: string) =>
  hasWitnessProgram(
    decodeBech32(address),
    (version) => version === 0,
    (length) => length === 20 || length === 32,
  ) ||
  hasWitnessProgram(
    decodeBech32m(address),
    (version) => version >= 1 && version <= 16,
    (length) => length >= 2 && length <= 40,
  );

const otherNetworkRecognisers: ReadonlyArray<
  readonly [OtherAddressNetwork, (address: string) => boolean]
> = [
  ["evm", isEvm],
  ["tron", isTron],
  [
    "bitcoin",
    (address) => isLegacyBitcoin(address) || isSegwitBitcoin(address),
  ],
];

const longestAddressLength = 90;

const otherNetworkAddress = (address: string) =>
  Option.map(
    Option.fromUndefinedOr(
      otherNetworkRecognisers.find(([, matches]) => matches(address)),
    ),
    ([network]) => RecognisedAddress.OtherNetworkAddress({ network }),
  );

export const recogniseAddress = (
  address: string,
): Option.Option<RecognisedAddress> => {
  if (address.length > longestAddressLength) return Option.none();

  return addressRules.hasValidChecksum(address)
    ? Option.some(RecognisedAddress.WalletNetworkAddress())
    : otherNetworkAddress(address);
};
