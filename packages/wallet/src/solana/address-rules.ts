import {
  getBase58Decoder,
  getBase58Encoder,
  isAddress,
  isOffCurveAddress,
} from "@solana/kit";
import type { AddressRules } from "../address-rules";

const base58Encoder = getBase58Encoder();
const base58Decoder = getBase58Decoder();

const isCanonicalAddress = (text: string) =>
  isAddress(text) && base58Decoder.decode(base58Encoder.encode(text)) === text;

export const solanaAddressRules: AddressRules = {
  isAccountAddress: isCanonicalAddress,
  isDestinationAddress: isCanonicalAddress,
  forbidsMemo: () => false,
  isUnclaimedFundsId: (text) =>
    isAddress(text) && isOffCurveAddress(text) && isCanonicalAddress(text),
  hasValidChecksum: isCanonicalAddress,
};
