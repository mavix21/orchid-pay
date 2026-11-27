import { stellarAddressRules } from "./stellar/address-rules";

export interface AddressRules {
  readonly isAccountAddress: (text: string) => boolean;
  readonly isDestinationAddress: (text: string) => boolean;
  readonly forbidsMemo: (text: string) => boolean;
  readonly isUnclaimedFundsId: (text: string) => boolean;
  readonly hasValidChecksum: (text: string) => boolean;
}

export const addressNetwork = "stellar";

export const addressRules: AddressRules = stellarAddressRules;
