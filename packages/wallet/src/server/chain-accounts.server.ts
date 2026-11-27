import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type { AccountAddress, Amount } from "../contract";
import type { ChainUnreachable } from "./chain-errors.server";

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
