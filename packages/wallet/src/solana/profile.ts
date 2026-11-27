import type { ChainProfile } from "../chain-profile";
import { solanaAddressRules } from "./address-rules";

const sixDecimals = { decimals: 6, maximum: 9223372036854775807n };

export const solanaProfile: ChainProfile = {
  addressRules: solanaAddressRules,
  baseAsset: {
    id: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    code: "USDC",
  },
  precisionOf: () => sixDecimals,
  draftTiming: { lifetime: 50, approvalMargin: 10 },
};
