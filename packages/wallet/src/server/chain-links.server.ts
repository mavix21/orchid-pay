import type * as Effect from "effect/Effect";
import type {
  AccountAddress,
  Asset,
  DestinationAddress,
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

export interface LinkChain {
  draftLinkReceive(
    receive: LinkReceive,
  ): Effect.Effect<SigningRequest, ChainUnreachable | StoreFailure>;
}
