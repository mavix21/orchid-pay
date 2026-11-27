import { addressRules } from "../address-rules";
import { unclaimedFundsIdOn } from "./address-schemas";

export const UnclaimedFundsId = unclaimedFundsIdOn(addressRules);

export type UnclaimedFundsId = typeof UnclaimedFundsId.Type;
