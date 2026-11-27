import * as Data from "effect/Data";
import type * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type { AccountAddress, UnclaimedFundsId } from "../contract";
import type { ChainUnreachable } from "./chain-errors.server";

export type AssetEvent = Data.TaggedEnum<{
  Payment: {
    readonly eventId: string;
    readonly from: string;
    readonly to: string;
    readonly amount: bigint;
    readonly hash: string;
    readonly ledger: number;
    readonly closedAt: DateTime.Utc;
  };
  UnclaimedFundsClaim: {
    readonly eventId: string;
    readonly unclaimedFunds: UnclaimedFundsId;
    readonly closedAt: DateTime.Utc;
  };
}>;

export const AssetEvent = Data.taggedEnum<AssetEvent>();

export type EventsStart = Data.TaggedEnum<{
  FromLedger: { readonly ledger: number };
  FromCursor: { readonly cursor: string };
}>;

export const EventsStart = Data.taggedEnum<EventsStart>();

export interface EventsQuery {
  readonly start: EventsStart;
  readonly wallet: Option.Option<AccountAddress>;
  readonly limit: number;
}

export interface DepositPosition {
  readonly cursor: string;
  readonly ledger: number;
}

export interface EventsPage {
  readonly events: ReadonlyArray<AssetEvent>;
  readonly position: DepositPosition;
  readonly drained: boolean;
  readonly cursorClosedAt: Option.Option<DateTime.Utc>;
}

export interface DepositChain {
  readonly depositFeed: string;
  resumeDeposits<E>(
    cursor: Effect.Effect<Option.Option<DepositPosition>, E>,
  ): Effect.Effect<EventsStart, ChainUnreachable | E>;
  catchUpDeposits(
    recent: Option.Option<DepositPosition>,
  ): Effect.Effect<EventsStart, ChainUnreachable>;
  assetEvents(query: EventsQuery): Effect.Effect<EventsPage, ChainUnreachable>;
}
