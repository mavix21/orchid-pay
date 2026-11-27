import { expect, it } from "@effect/vitest";
import { bech32, bech32m } from "@scure/base";
import * as Option from "effect/Option";
import { type AddressNetwork, recogniseAddress } from "../src/contract";

const stellarAccount =
  "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6";

const stellarMuxed =
  "MDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUIAAAAAAAAAAAAESPG";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const flipLowestBit = (address: string, fromEnd: number) => {
  const position = address.length - fromEnd;
  const index = base32Alphabet.indexOf(address.charAt(position));

  return `${address.slice(0, position)}${base32Alphabet.charAt(index ^ 1)}${address.slice(position + 1)}`;
};

it.each<{ name: string; address: string; network: AddressNetwork }>([
  { name: "Stellar account", address: stellarAccount, network: "stellar" },
  { name: "Stellar muxed account", address: stellarMuxed, network: "stellar" },
  {
    name: "EVM checksummed",
    address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    network: "evm",
  },
  {
    name: "Solana",
    address: "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB",
    network: "solana",
  },
  {
    name: "Tron",
    address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    network: "tron",
  },
  {
    name: "Bitcoin taproot",
    address: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
    network: "bitcoin",
  },
])("recognises a $name address", ({ address, network }) => {
  expect(recogniseAddress(address)).toEqual(Option.some(network));
});

it.each<{ name: string; address: string }>([
  {
    name: "Stellar account with a bad checksum",
    address: `${stellarAccount.slice(0, -1)}A`,
  },
  {
    name: "Stellar muxed account with a bad checksum",
    address: flipLowestBit(stellarMuxed, 2),
  },
  {
    name: "Stellar muxed account with its unused last bit set",
    address: flipLowestBit(stellarMuxed, 1),
  },
  {
    name: "Stellar account with another version byte and a matching checksum",
    address: "GEDQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQPOLF",
  },
  {
    name: "EVM mixed-case with a wrong capital",
    address: "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  },
  {
    name: "Bitcoin witness v0 with a bech32m checksum",
    address: bech32m.encode("bc", [
      0,
      ...bech32.toWords(new Uint8Array(20).fill(1)),
    ]),
  },
])("rejects $name", ({ address }) => {
  expect(recogniseAddress(address)).toEqual(Option.none());
});
