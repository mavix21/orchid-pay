import * as Schema from "effect/Schema";
import { addressRules } from "../address-rules";

export const UnclaimedFundsId = Schema.String.check(
  Schema.makeFilter(addressRules.isUnclaimedFundsId),
).pipe(Schema.brand("UnclaimedFundsId"));

export type UnclaimedFundsId = typeof UnclaimedFundsId.Type;
