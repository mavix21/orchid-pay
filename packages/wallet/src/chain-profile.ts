import type { AddressRules } from "./address-rules";
import type { AssetPrecision } from "./contract/assets";

export interface AssetTerms {
  readonly id: string;
  readonly code: string;
}

export interface DraftTimingTerms {
  readonly lifetime: number;
  readonly approvalMargin: number;
}

export interface ChainProfile {
  readonly addressRules: AddressRules;
  readonly baseAsset: AssetTerms;
  readonly precisionOf: (assetId: string) => AssetPrecision;
  readonly draftTiming: DraftTimingTerms;
}
