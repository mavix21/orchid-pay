import { expect, it } from "@effect/vitest";
import { bech32, bech32m } from "@scure/base";
import * as Option from "effect/Option";
import {
  type OtherAddressNetwork,
  RecognisedAddress,
  recogniseAddress,
} from "../src/contract";

const { WalletNetworkAddress, OtherNetworkAddress } = RecognisedAddress;

const on = (network: OtherAddressNetwork) => OtherNetworkAddress({ network });

it.each<{ name: string; address: string; recognised: RecognisedAddress }>([
  {
    name: "Solana",
    address: "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB",
    recognised: WalletNetworkAddress(),
  },
  {
    name: "EVM checksummed",
    address: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    recognised: on("evm"),
  },
  {
    name: "Tron",
    address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    recognised: on("tron"),
  },
  {
    name: "Bitcoin taproot",
    address: "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0",
    recognised: on("bitcoin"),
  },
])("recognises a $name address", ({ address, recognised }) => {
  expect(recogniseAddress(address)).toEqual(Option.some(recognised));
});

it.each<{ name: string; address: string }>([
  {
    name: "Solana address with an extra leading zero byte",
    address: "1GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB",
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
