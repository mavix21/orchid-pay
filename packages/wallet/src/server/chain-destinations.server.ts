import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type {
  AccountAddress,
  Asset,
  DestinationAddress,
  PositiveAmount,
  RecipientCannotReceive,
} from "../contract";
import type { ChainUnreachable } from "./chain-errors.server";

export type MemoRule = Data.TaggedEnum<{
  MemoForbidden: {};
  MemoOptional: {};
  MemoRequired: {
    readonly account: AccountAddress;
    readonly exchange: string;
    readonly source: string;
  };
}>;

export const MemoRule = Data.taggedEnum<MemoRule>();

export type ReceiveBlocker = RecipientCannotReceive["reason"];

export interface DestinationChain {
  receivingAccount(destination: DestinationAddress): AccountAddress;
  destinationPrefixesPayingInto(account: AccountAddress): ReadonlyArray<string>;
  memoRule(
    destination: DestinationAddress,
  ): Effect.Effect<MemoRule, ChainUnreachable>;
  receiveBlocker(
    account: AccountAddress,
    asset: Asset,
    amount: PositiveAmount,
  ): Effect.Effect<Option.Option<ReceiveBlocker>, ChainUnreachable>;
}
