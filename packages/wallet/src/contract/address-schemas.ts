import * as Schema from "effect/Schema";
import type { AddressRules } from "../address-rules";

const destinationAddressOn = (rules: AddressRules) =>
  Schema.String.check(Schema.makeFilter(rules.isDestinationAddress)).pipe(
    Schema.brand("DestinationAddress"),
  );

export const accountAddressSchemas = (rules: AddressRules) => {
  const destination = destinationAddressOn(rules);

  return {
    destination,
    account: destination
      .check(Schema.makeFilter(rules.isAccountAddress))
      .pipe(Schema.brand("AccountAddress")),
  };
};

export const unclaimedFundsIdOn = (rules: AddressRules) =>
  Schema.String.check(Schema.makeFilter(rules.isUnclaimedFundsId)).pipe(
    Schema.brand("UnclaimedFundsId"),
  );
