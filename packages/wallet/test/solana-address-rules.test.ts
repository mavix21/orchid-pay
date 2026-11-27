import { describe, expect, it } from "@effect/vitest";
import {
  address,
  getAddressEncoder,
  getBase58Decoder,
  getProgramDerivedAddress,
} from "@solana/kit";
import { solanaAddressRules } from "../src/solana/address-rules";
import { solanaProfile } from "../src/solana/profile";

const wallet = address("EfMyugvKBr7JPsxFTUE7Z67sBNJj9NWCRbyt9p7fojBN");
const tokenProgram = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const associatedTokenProgram = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

const addressEncoder = getAddressEncoder();

const [vault] = await getProgramDerivedAddress({
  programAddress: address("SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf"),
  seeds: ["vault"],
});

const [tokenAccount] = await getProgramDerivedAddress({
  programAddress: associatedTokenProgram,
  seeds: [
    addressEncoder.encode(wallet),
    addressEncoder.encode(tokenProgram),
    addressEncoder.encode(address(solanaProfile.baseAsset.id)),
  ],
});

const zeroLeadingAddress = getBase58Decoder().decode(
  new Uint8Array(32).fill(7).fill(0, 0, 1),
);

const verdicts = (text: string) => ({
  account: solanaAddressRules.isAccountAddress(text),
  destination: solanaAddressRules.isDestinationAddress(text),
  checksum: solanaAddressRules.hasValidChecksum(text),
});

const accepted = { account: true, destination: true, checksum: true };
const rejected = { account: false, destination: false, checksum: false };

describe("Solana address rules", () => {
  it.each([
    { name: "a wallet address", text: wallet },
    { name: "an off-curve vault", text: vault },
    { name: "a token-account destination", text: tokenAccount },
    { name: "an address with a leading zero byte", text: zeroLeadingAddress },
  ])("accepts $name", ({ text }) => {
    expect(verdicts(text)).toEqual(accepted);
  });

  it.each([
    {
      name: "non-canonical base58 with an extra leading zero",
      text: `1${zeroLeadingAddress}`,
    },
    {
      name: "non-canonical base58 missing its leading zero",
      text: zeroLeadingAddress.slice(1),
    },
    {
      name: "a character outside the base58 alphabet",
      text: `0${wallet.slice(1)}`,
    },
  ])("rejects $name", ({ text }) => {
    expect(verdicts(text)).toEqual(rejected);
  });

  it.each([
    { name: "an off-curve escrow address", text: vault, identifies: true },
    { name: "a wallet address", text: wallet, identifies: false },
  ])(
    "reads $name as an unclaimed funds id: $identifies",
    ({ text, identifies }) => {
      expect(solanaAddressRules.isUnclaimedFundsId(text)).toBe(identifies);
    },
  );
});
