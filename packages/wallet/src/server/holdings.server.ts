import type * as Option from "effect/Option";
import type { AccountAddress, Amount, Asset } from "../contract";

export interface Line {
  readonly asset: Asset;
  readonly balance: Amount;

  readonly spendable: Amount;
  readonly capacity: Amount;
  readonly authorized: boolean;

  readonly sponsored: boolean;
}

export interface Holdings {
  readonly reserveSponsor: Option.Option<AccountAddress>;

  readonly lines: ReadonlyArray<Line>;
}
