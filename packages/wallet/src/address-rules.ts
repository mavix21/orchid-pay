import { chainProfile } from "./binding/profile";

export interface AddressRules {
  readonly isAccountAddress: (text: string) => boolean;
  readonly isDestinationAddress: (text: string) => boolean;
  readonly forbidsMemo: (text: string) => boolean;
  readonly isUnclaimedFundsId: (text: string) => boolean;
  readonly hasValidChecksum: (text: string) => boolean;
}

export const { addressRules } = chainProfile;
