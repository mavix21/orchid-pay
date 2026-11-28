import { Database } from "@workspace/db";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import * as Option from "effect/Option";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  UnclaimedFundsId,
  Profile,
  ReceivedPaymentLink,
  Username,
} from "../contract";
import { claimableReadLimit } from "../policy";
import { epochAt, network } from "../record-network";
import { StoreFailure } from "./Directory.server";
import { StoredOrderJson } from "./AssetOrders.server";
import { assetOrders, transfers, usernames } from "./tables.server";
import {
  FundedLink,
  OpenLinkRecord,
  OrderJson,
} from "./transfer-records.server";

export const unclaimedAt = (now: number) =>
  and(
    eq(transfers.network, network),
    eq(transfers.testnetEpoch, epochAt(now)),
    isNotNull(transfers.balanceId),
    isNull(transfers.balanceClosedAt),
  );

export const openFromAt = (sender: AccountAddress, now: number) =>
  and(
    unclaimedAt(now),
    eq(transfers.sender, sender),
    eq(transfers.claimableKind, "paymentLink"),
    inArray(transfers.status, ["authorized", "settled"]),
  );

export const openClaimableCountFrom = Effect.fn("Transfers.openClaimables")(
  function* (sender: AccountAddress) {
    const db = yield* Database;
    const now = yield* Clock.currentTimeMillis;

    const rows = yield* db
      .select({ total: count() })
      .from(transfers)
      .where(openFromAt(sender, now));

    return rows[0]?.total ?? 0;
  },
);

export const settledOpenUnclaimedFundsFrom = Effect.fn(
  "Transfers.settledOpenUnclaimedFunds",
)(function* (sender: AccountAddress) {
  const db = yield* Database;
  const now = yield* Clock.currentTimeMillis;

  const rows = yield* db
    .select({ unclaimedFunds: transfers.balanceId })
    .from(transfers)
    .where(and(openFromAt(sender, now), eq(transfers.status, "settled")))
    .limit(claimableReadLimit);

  return rows.flatMap((row) =>
    row.unclaimedFunds
      ? [Schema.decodeSync(UnclaimedFundsId)(row.unclaimedFunds)]
      : [],
  );
});

export const openPaymentLinksFor = Effect.fn("Transfers.openPaymentLinks")(
  function* (sender: AccountAddress) {
    const db = yield* Database;
    const now = yield* Clock.currentTimeMillis;

    const rows = yield* db
      .select({
        unclaimedFunds: transfers.balanceId,
        order: transfers.order,
        createdAt: transfers.createdAt,
      })
      .from(transfers)
      .where(
        and(
          unclaimedAt(now),
          eq(transfers.sender, sender),
          eq(transfers.claimableKind, "paymentLink"),
          eq(transfers.status, "settled"),
        ),
      )
      .orderBy(desc(transfers.createdAt))
      .limit(claimableReadLimit);

    return yield* Effect.try({
      try: () =>
        rows.flatMap((row) => {
          const order = Schema.decodeSync(OrderJson)(row.order);

          return Predicate.isTagged(order.to, "PaymentLink") &&
            row.unclaimedFunds !== null
            ? [
                new OpenLinkRecord({
                  id: order.id,
                  unclaimedFunds: Schema.decodeSync(UnclaimedFundsId)(
                    row.unclaimedFunds,
                  ),
                  address: order.to.value,
                  asset: order.asset,
                  amount: order.amount,
                  createdAt: DateTime.makeUnsafe(row.createdAt),
                }),
              ]
            : [];
        }),
      catch: (cause) => new StoreFailure({ cause }),
    });
  },
);

export const fundedLinkAt = Effect.fn("Transfers.fundedLink")(function* (
  link: AccountAddress,
) {
  const db = yield* Database;
  const now = yield* Clock.currentTimeMillis;

  const rows = yield* db
    .select({
      unclaimedFunds: transfers.balanceId,
      order: transfers.order,
      sender: transfers.sender,
      username: usernames.username,
    })
    .from(transfers)
    .innerJoin(usernames, eq(usernames.address, transfers.sender))
    .where(
      and(
        eq(transfers.network, network),
        eq(transfers.testnetEpoch, epochAt(now)),
        eq(transfers.destination, link),
        eq(transfers.claimableKind, "paymentLink"),
        eq(transfers.status, "settled"),
        isNotNull(transfers.balanceId),
      ),
    )
    .orderBy(desc(transfers.createdAt))
    .limit(1);

  return yield* Effect.try({
    try: () =>
      Option.fromNullishOr(rows[0]).pipe(
        Option.flatMap((row) => {
          const order = Schema.decodeSync(OrderJson)(row.order);

          return Predicate.isTagged(order.to, "PaymentLink") &&
            order.to.value === link &&
            row.unclaimedFunds !== null
            ? Option.some(
                new FundedLink({
                  unclaimedFunds: Schema.decodeSync(UnclaimedFundsId)(
                    row.unclaimedFunds,
                  ),
                  sender: new Profile({
                    address: Schema.decodeSync(AccountAddress)(row.sender),
                    username: Schema.decodeSync(Username)(row.username),
                  }),
                  asset: order.asset,
                  amount: order.amount,
                }),
              )
            : Option.none();
        }),
      ),
    catch: (cause) => new StoreFailure({ cause }),
  });
});

export const receivedPaymentLinksFor = Effect.fn(
  "Transfers.receivedPaymentLinks",
)(function* (sender: AccountAddress) {
  const db = yield* Database;
  const now = yield* Clock.currentTimeMillis;

  const rows = yield* db
    .select({
      order: transfers.order,
      receive: assetOrders.order,
      receivedAt: assetOrders.concludedAt,
    })
    .from(transfers)
    .innerJoin(
      assetOrders,
      and(
        eq(assetOrders.balanceId, transfers.balanceId),
        eq(assetOrders.network, transfers.network),
        eq(assetOrders.testnetEpoch, transfers.testnetEpoch),
        eq(assetOrders.status, "settled"),
        sql`${assetOrders.order}::jsonb -> 'action' ->> '_tag' in ('ReceiveLink', 'ReceiveLinkExternal')`,
      ),
    )
    .where(
      and(
        eq(transfers.network, network),
        eq(transfers.testnetEpoch, epochAt(now)),
        eq(transfers.sender, sender),
        eq(transfers.claimableKind, "paymentLink"),
        eq(transfers.status, "settled"),
        isNotNull(transfers.balanceClosedAt),
      ),
    )
    .orderBy(desc(assetOrders.concludedAt))
    .limit(claimableReadLimit);

  return yield* Effect.try({
    try: () =>
      rows.flatMap((row) => {
        const order = Schema.decodeSync(OrderJson)(row.order);
        const receive = Schema.decodeSync(StoredOrderJson)(row.receive);

        return Predicate.isTagged(order.to, "PaymentLink") &&
          (Predicate.isTagged(receive.action, "ReceiveLink") ||
            Predicate.isTagged(receive.action, "ReceiveLinkExternal")) &&
          receive.action.link === order.to.value &&
          row.receivedAt !== null
          ? [
              new ReceivedPaymentLink({
                id: order.id,
                address: order.to.value,
                asset: order.asset,
                amount: order.amount,
                receivedAt: DateTime.makeUnsafe(row.receivedAt),
              }),
            ]
          : [];
      }),
    catch: (cause) => new StoreFailure({ cause }),
  });
});
