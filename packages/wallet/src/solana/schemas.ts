import {
  accountAddressSchemas,
  unclaimedFundsIdOn,
} from "../contract/address-schemas";
import { solanaAddressRules } from "./address-rules";

export const SolanaAccountAddress =
  accountAddressSchemas(solanaAddressRules).account;

export const SolanaUnclaimedFundsId = unclaimedFundsIdOn(solanaAddressRules);
