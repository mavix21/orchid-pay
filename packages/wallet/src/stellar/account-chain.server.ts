import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { AccountAddress } from "../contract";
import type {
  AccountChain,
  AccountStanding,
} from "../server/chain-accounts.server";
import type { ChainUnreachable } from "../server/chain-errors.server";
import type { AccountState } from "./ledger.server";

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
