import type * as Effect from "effect/Effect";
import type {
  AccountAddress,
  Asset,
  DestinationAddress,
  LinkUnclaimable,
  PaymentMemo,
  PositiveAmount,
  SigningRequest,
  UnclaimedFundsId,
} from "../contract";
import type { ChainUnreachable } from "./chain-errors.server";
import type { StoreFailure } from "./store-failure.server";

export interface LinkReceive {
  readonly link: AccountAddress;
  readonly destination: DestinationAddress;
  readonly unclaimedFunds: UnclaimedFundsId;
  readonly asset: Asset;
  readonly amount: PositiveAmount;
  readonly memo?: PaymentMemo;
}

export interface PreparedLinkReceive extends LinkReceive {
  readonly createsLinkAccount: boolean;
}

export interface LinkChain {
  prepareLinkReceive(
    receive: LinkReceive,
  ): Effect.Effect<PreparedLinkReceive | LinkUnclaimable, ChainUnreachable>;
  draftLinkReceive(
    receive: PreparedLinkReceive,
  ): Effect.Effect<SigningRequest, ChainUnreachable | StoreFailure>;
  cleanUpLink(link: AccountAddress): Effect.Effect<boolean, ChainUnreachable>;
}
