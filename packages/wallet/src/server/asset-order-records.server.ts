import * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  AssetFailed,
  AssetOrder,
  AssetOrderId,
  AssetPending,
  AssetSettled,
  UnclaimedFundsId,
  DestinationAddress,
  ExternalLinkFailed,
  type ExternalLinkOrder,
  ExternalLinkPending,
  ExternalLinkSettled,
  PaymentMemo,
  PayoutTerms,
  SigningRequest,
} from "../contract";
import { Sealed } from "./Chain.server";
import type { assetOrders } from "./tables.server";

export const ReceiveLinkExternal = Schema.TaggedStruct("ReceiveLinkExternal", {
  link: AccountAddress,
  unclaimedFunds: UnclaimedFundsId,
  destination: DestinationAddress,
  memo: Schema.optional(PaymentMemo),
  payout: Schema.optional(PayoutTerms),
});

export class StoredExternalOrder extends Schema.Class<StoredExternalOrder>(
  "@workspace/wallet/StoredExternalOrder",
)({
  id: AssetOrderId,
  action: ReceiveLinkExternal,
}) {}

export const StoredOrder = Schema.Union([AssetOrder, StoredExternalOrder]);

export type StoredOrder = typeof StoredOrder.Type;

export const toStoredExternalOrder = (
  order: ExternalLinkOrder,
  payout: Option.Option<PayoutTerms> = Option.none(),
) =>
  new StoredExternalOrder({
    id: order.id,
    action: ReceiveLinkExternal.make({
      link: order.link,
      unclaimedFunds: order.unclaimedFunds,
      destination: order.destination,
      memo: order.memo,
      payout: Option.getOrUndefined(payout),
    }),
  });

export class AssetProposed extends Schema.TaggedClass<AssetProposed>()(
  "AssetProposed",
  {
    order: StoredOrder,
    request: SigningRequest,
  },
) {}

export class AssetAuthorized extends Schema.TaggedClass<AssetAuthorized>()(
  "AssetAuthorized",
  {
    order: StoredOrder,
    sealed: Sealed,
  },
) {}

export const ConcludedReceipt = Schema.Union([
  AssetSettled,
  AssetFailed,
  ExternalLinkSettled,
  ExternalLinkFailed,
]);

export type ConcludedReceipt = typeof ConcludedReceipt.Type;

export class AssetConcluded extends Schema.TaggedClass<AssetConcluded>()(
  "AssetConcluded",
  {
    order: StoredOrder,
    receipt: ConcludedReceipt,
  },
) {}

export type StoredAssetOrder = AssetProposed | AssetAuthorized | AssetConcluded;

export type AssetOrderRow = typeof assetOrders.$inferSelect;

export interface ConclusionColumns {
  readonly status: "settled" | "failed";
  readonly concludedAt: Date;
  readonly failure: "expired" | "rejected" | null;
}

export const AssetOrderJson = Schema.fromJsonString(AssetOrder);
export const StoredOrderJson = Schema.fromJsonString(StoredOrder);

export function assetPending(
  order: AssetAuthorized & { readonly order: AssetOrder },
): AssetPending {
  return new AssetPending({
    id: order.order.id,
    action: order.order.action,
    expiresAt: order.sealed.expiresAt,
  });
}

export function externalPending(order: AssetAuthorized): ExternalLinkPending {
  return new ExternalLinkPending({
    id: order.order.id,
    expiresAt: order.sealed.expiresAt,
  });
}

export function orderPending(
  order: AssetAuthorized,
): AssetPending | ExternalLinkPending {
  return order.order instanceof AssetOrder
    ? new AssetPending({
        id: order.order.id,
        action: order.order.action,
        expiresAt: order.sealed.expiresAt,
      })
    : externalPending(order);
}

export function readRow(row: AssetOrderRow): StoredAssetOrder {
  const order = Schema.decodeSync(StoredOrderJson)(row.order);
  const expiresAt = DateTime.makeUnsafe(row.expiresAt);

  return Match.value(row.status).pipe(
    Match.when(
      "proposed",
      () =>
        new AssetProposed({
          order,
          request: new SigningRequest({
            envelope: Schema.decodeSync(SigningRequest.fields.envelope)(
              row.envelope,
            ),
            expiresAt,
          }),
        }),
    ),
    Match.when("authorized", () => {
      if (!row.hash) throw new Error("Authorized asset order missing hash");

      return new AssetAuthorized({
        order,
        sealed: new Sealed({
          envelope: row.envelope,
          hash: row.hash,
          expiresAt,
        }),
      });
    }),
    Match.when("settled", () => {
      if (!row.concludedAt)
        throw new Error("Settled asset order missing ledger time");

      const settledAt = DateTime.makeUnsafe(row.concludedAt);

      return new AssetConcluded({
        order,
        receipt:
          order instanceof AssetOrder
            ? new AssetSettled({
                id: order.id,
                action: order.action,
                settledAt,
              })
            : new ExternalLinkSettled({ id: order.id, settledAt }),
      });
    }),
    Match.when("failed", () => {
      if (!row.failure) throw new Error("Failed asset order missing reason");

      return new AssetConcluded({
        order,
        receipt:
          order instanceof AssetOrder
            ? new AssetFailed({
                id: order.id,
                action: order.action,
                reason: row.failure,
              })
            : new ExternalLinkFailed({ id: order.id, reason: row.failure }),
      });
    }),
    Match.exhaustive,
  );
}
