import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  AssetOrder,
  AssetOrderId,
  AwaitingAcceptanceActivity,
  UnclaimedFundsId,
  Claimed,
  ClaimedLinkActivity,
  DepositActivity,
  DepositId,
  DestinationAddress,
  ExternalRecipient,
  PositiveAmount,
  Profile,
  ReceivedActivity,
  Refunded,
  Reserved,
  type Receipt,
  SentActivity,
  type Settled,
  TakenBackActivity,
  TransferId,
  Username,
} from "../contract";
import { assetFromColumns } from "../record-network";
import { StoreFailure } from "./Directory.server";
import type { deposits } from "./tables.server";
import type { StoredOrder } from "./asset-order-records.server";
import {
  OrderJson,
  pending,
  readTransferRow,
  type TransferRow,
} from "./transfer-records.server";

export interface ClosingOrder {
  readonly order: StoredOrder;
  readonly enrollmentReceive: boolean;
}

export type Closers = ReadonlyMap<string, ClosingOrder>;

export type Profiles = ReadonlyMap<string, Profile>;

export interface SentRow {
  readonly row: TransferRow;
}

export interface ReceivedRow {
  readonly row: TransferRow;
  readonly username: string;
}

export interface LinkClaimRow {
  readonly id: string;
  readonly concludedAt: Date;
  readonly transferOrder: string;
  readonly sender: string;
  readonly username: string;
}

const closedAt = (row: TransferRow) =>
  row.balanceClosedAt === null
    ? undefined
    : DateTime.makeUnsafe(row.balanceClosedAt);

const closerOf = (row: TransferRow, closers: Closers) =>
  row.balanceId === null ? undefined : closers.get(row.balanceId);

const isReclaimBy = (order: StoredOrder | undefined, wallet: string) =>
  order instanceof AssetOrder &&
  Predicate.isTagged(order.action, "ClaimUnclaimedFunds") &&
  order.wallet === wallet;

const claimerOf = (order: StoredOrder, profiles: Profiles) =>
  order instanceof AssetOrder
    ? profiles.get(order.wallet)
    : new ExternalRecipient({ address: order.action.destination });

const unclaimedFundsReceipt = (
  settled: Settled,
  row: TransferRow,
  closers: Closers,
  profiles: Profiles,
): Receipt => {
  const fields = {
    id: settled.id,
    to: settled.to,
    recipient: settled.recipient,
    asset: settled.asset,
    amount: settled.amount,
    memo: settled.memo,
    unclaimedFunds: settled.unclaimedFunds,
  };

  const closed = closedAt(row);

  if (closed === undefined) return new Reserved(fields);

  const closer = closerOf(row, closers);

  return isReclaimBy(closer?.order, row.sender)
    ? new Refunded({ ...fields, closedAt: closed })
    : new Claimed({
        ...fields,
        by:
          closer === undefined ? undefined : claimerOf(closer.order, profiles),
        openedWallet: closer?.enrollmentReceive ? true : undefined,
        closedAt: closed,
      });
};

export const sentEntry = (
  { row }: SentRow,
  closers: Closers,
  profiles: Profiles,
) =>
  Effect.try({
    try: () => {
      const transfer = readTransferRow(row);

      if (Predicate.isTagged(transfer, "Proposed"))
        throw new Error("A draft has no activity");

      const receipt = Predicate.isTagged(transfer, "Authorized")
        ? pending(transfer)
        : Predicate.isTagged(transfer.receipt, "Settled") &&
            transfer.receipt.unclaimedFunds !== undefined
          ? unclaimedFundsReceipt(transfer.receipt, row, closers, profiles)
          : transfer.receipt;

      return new SentActivity({
        id: Schema.decodeSync(TransferId)(row.id),
        createdAt: DateTime.makeUnsafe(row.createdAt),
        receipt,
      });
    },
    catch: (cause) => new StoreFailure({ cause }),
  });

export const receivedEntry = (
  { row, username }: ReceivedRow,
  closers: Closers,
) =>
  Effect.try({
    try: () => {
      const order = Schema.decodeSync(OrderJson)(row.order);

      const fields = {
        id: order.id,
        createdAt: DateTime.makeUnsafe(row.createdAt),
        from: new Profile({
          address: Schema.decodeSync(AccountAddress)(row.sender),
          username: Schema.decodeSync(Username)(username),
        }),
        asset: order.asset,
        amount: order.amount,
      };

      if (row.balanceId === null) return new ReceivedActivity(fields);

      const closed = closedAt(row);

      if (closed === undefined)
        return new AwaitingAcceptanceActivity({
          ...fields,
          unclaimedFunds: Schema.decodeSync(UnclaimedFundsId)(row.balanceId),
        });

      return isReclaimBy(closerOf(row, closers)?.order, row.sender)
        ? new TakenBackActivity({ ...fields, closedAt: closed })
        : new ReceivedActivity({ ...fields, closedAt: closed });
    },
    catch: (cause) => new StoreFailure({ cause }),
  });

export const linkClaimEntry = (claim: LinkClaimRow) =>
  Effect.try({
    try: () => {
      const link = Schema.decodeSync(OrderJson)(claim.transferOrder);

      return new ClaimedLinkActivity({
        id: Schema.decodeSync(AssetOrderId)(claim.id),
        createdAt: DateTime.makeUnsafe(claim.concludedAt),
        from: new Profile({
          address: Schema.decodeSync(AccountAddress)(claim.sender),
          username: Schema.decodeSync(Username)(claim.username),
        }),
        asset: link.asset,
        amount: link.amount,
      });
    },
    catch: (cause) => new StoreFailure({ cause }),
  });

export const depositEntry = (row: typeof deposits.$inferSelect) =>
  Effect.try({
    try: () =>
      new DepositActivity({
        id: Schema.decodeSync(DepositId)(row.id),
        createdAt: DateTime.makeUnsafe(row.closedAt),
        from: new ExternalRecipient({
          address: Schema.decodeSync(DestinationAddress)(row.sender),
        }),
        asset: assetFromColumns(row),
        amount: Schema.decodeSync(PositiveAmount)(row.amount.toString()),
      }),
    catch: (cause) => new StoreFailure({ cause }),
  });
