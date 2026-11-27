import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { AccountAddress, Amount } from "../contract";
import type { ChainUnreachable } from "./chain-errors.server";
import type { AccountState } from "../stellar/ledger.server";

export type AccountStanding =
  | "absent"
  | "incomplete"
  | "open"
  | "foreign"
  | "foreignIncomplete";

export interface AccountChain {
  standing(
    address: AccountAddress,
  ): Effect.Effect<AccountStanding, ChainUnreachable>;
  balance(
    address: AccountAddress,
  ): Effect.Effect<Option.Option<Amount>, ChainUnreachable>;
}

const standingOf = (state: AccountState): AccountStanding => {
  if (Option.isNone(state.balance))
    return state.accountSponsored ? "incomplete" : "foreignIncomplete";

  return state.sponsored ? "open" : "foreign";
};

export const accountChain = (
  account: (
    address: AccountAddress,
  ) => Effect.Effect<Option.Option<AccountState>, ChainUnreachable>,
): AccountChain => ({
  standing: (address) =>
    account(address).pipe(
      Effect.map(
        Option.match({
          onNone: (): AccountStanding => "absent",
          onSome: standingOf,
        }),
      ),
    ),
  balance: (address) =>
    account(address).pipe(Effect.map(Option.flatMap((state) => state.balance))),
});
