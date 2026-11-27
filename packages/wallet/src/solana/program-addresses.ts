import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  type Address,
  type ReadonlyUint8Array,
  getAddressDecoder,
  getAddressEncoder,
  isOffCurveAddress,
} from "@solana/kit";
import {
  ORCHID_LINKS_PROGRAM_ADDRESS,
  USDC_MINT_ADDRESS,
  getUnclaimedFundsSeeds,
  getVaultSeeds,
} from "@workspace/orchid-links";

const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();
const marker = new TextEncoder().encode("ProgramDerivedAddress");

const programDerivedAddress = (
  programAddress: Address,
  seeds: ReadonlyArray<ReadonlyUint8Array>,
): Address => {
  const parts = seeds.map((seed) => new Uint8Array(seed));
  const program = new Uint8Array(addressEncoder.encode(programAddress));

  for (let bump = 255; bump > 0; bump -= 1) {
    const candidate = addressDecoder.decode(
      sha256(concatBytes(...parts, Uint8Array.of(bump), program, marker)),
    );

    if (isOffCurveAddress(candidate)) return candidate;
  }

  throw new RangeError("These seeds have no program derived address");
};

export const usdcAccountOf = (owner: Address) =>
  programDerivedAddress(ASSOCIATED_TOKEN_PROGRAM_ADDRESS, [
    addressEncoder.encode(owner),
    addressEncoder.encode(TOKEN_PROGRAM_ADDRESS),
    addressEncoder.encode(USDC_MINT_ADDRESS),
  ]);

export const unclaimedFundsAddressOf = (
  sender: Address,
  link: Address,
  orderId: ReadonlyUint8Array,
) =>
  programDerivedAddress(
    ORCHID_LINKS_PROGRAM_ADDRESS,
    getUnclaimedFundsSeeds(sender, link, orderId),
  );

export const vaultAddressOf = (unclaimedFunds: Address) =>
  programDerivedAddress(
    ORCHID_LINKS_PROGRAM_ADDRESS,
    getVaultSeeds(unclaimedFunds),
  );
