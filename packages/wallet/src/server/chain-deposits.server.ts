import type * as DateTime from "effect/DateTime";
import type * as Option from "effect/Option";
import type * as Stream from "effect/Stream";
import type { AccountAddress } from "../contract";
import type { ChainUnreachable } from "./chain-errors.server";

export interface ChainDeposit {
  readonly eventId: string;
  readonly from: string;
  readonly amount: bigint;
  readonly hash: string;
  readonly ledger: number;
  readonly closedAt: DateTime.Utc;
}

export interface DepositPosition {
  readonly cursor: string;
  readonly ledger: number;
}

export interface DepositPage {
  readonly deposits: ReadonlyArray<ChainDeposit>;
  readonly position: DepositPosition;
}

export interface DepositChain {
  depositsInto(
    wallet: AccountAddress,
    after: Option.Option<DepositPosition>,
  ): Stream.Stream<DepositPage, ChainUnreachable>;
}
