import * as Schema from "effect/Schema";
import { Amount } from "../src/contract";
import { assetFromColumns } from "../src/record-network";
import { randomAddress } from "./test-keys";

const amount = (value: string) => Schema.decodeSync(Amount)(value);

export const euro = assetFromColumns({ code: "EUR", issuer: randomAddress() });

export const euroLine = (
  balance: string,
  overrides: { readonly capacity?: Amount } = {},
) => ({
  asset: euro,
  balance: amount(balance),
  spendable: amount(balance),
  capacity: overrides.capacity ?? amount("9223372036854775807"),
  authorized: true,
  clawbackEnabled: false,
  sponsored: true,
});
