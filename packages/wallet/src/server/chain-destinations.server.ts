import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type {
  AccountAddress,
  Asset,
  PositiveAmount,
  RecipientCannotReceive,
} from "../contract";
import type { ChainUnreachable } from "./chain-errors.server";

export type ReceiveBlocker = RecipientCannotReceive["reason"];

export interface DestinationChain {
  receiveBlocker(
    account: AccountAddress,
    asset: Asset,
    amount: PositiveAmount,
  ): Effect.Effect<Option.Option<ReceiveBlocker>, ChainUnreachable>;
}
