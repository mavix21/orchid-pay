import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { base58, bech32, bech32m, createBase58check } from "@scure/base";
import * as Option from "effect/Option";
import { addressNetwork, addressRules } from "../address-rules";

export type AddressNetwork =
  | typeof addressNetwork
  | "evm"
  | "solana"
  | "tron"
  | "bitcoin";

const decodeBase58 = Option.liftThrowable(base58.decode);

const decodeBase58Check = Option.liftThrowable(
  createBase58check(sha256).decode,
);

const decodeBech32 = Option.liftThrowable(bech32.decode);

const decodeBech32m = Option.liftThrowable(bech32m.decode);

const wordsToBytes = Option.liftThrowable(bech32.fromWords);

const decodeCurvePoint = Option.liftThrowable(ed25519.Point.fromBytes);

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

const isSolana = (address: string) =>
  decodeBase58(address).pipe(
    Option.filter((bytes) => bytes.length === 32),
    Option.flatMap(decodeCurvePoint),
    Option.isSome,
  );

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

const recognisers: ReadonlyArray<
  readonly [AddressNetwork, (address: string) => boolean]
> = [
  [addressNetwork, addressRules.hasValidChecksum],
  ["evm", isEvm],
  ["solana", isSolana],
  ["tron", isTron],
  [
    "bitcoin",
    (address) => isLegacyBitcoin(address) || isSegwitBitcoin(address),
  ],
];

const longestAddressLength = 90;

export const recogniseAddress = (
  address: string,
): Option.Option<AddressNetwork> =>
  address.length > longestAddressLength
    ? Option.none()
    : Option.map(
        Option.fromUndefinedOr(
          recognisers.find(([, matches]) => matches(address)),
        ),
        ([network]) => network,
      );
