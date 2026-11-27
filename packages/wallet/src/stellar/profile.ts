import type { AssetTerms, ChainProfile } from "../chain-profile";
import { stellarAddressRules } from "./address-rules";

export const stellarNativeTerms: AssetTerms = { id: "native", code: "XLM" };

const sevenDecimals = { decimals: 7, maximum: 9223372036854775807n };

export const stellarProfile: ChainProfile = {
  addressRules: stellarAddressRules,
  baseAsset: {
    id: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    code: "USDC",
  },
  nativeAsset: stellarNativeTerms,
  precisionOf: () => sevenDecimals,
  draftTiming: { lifetime: 120, approvalMargin: 20 },
};
