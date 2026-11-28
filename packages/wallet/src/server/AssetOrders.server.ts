import { Database } from "@workspace/db";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  AssetOrder,
  AssetOrderId,
  type UnclaimedFundsId,
  type SigningRequest,
} from "../contract";
import { approvalMargin } from "../policy";
import { epochAt, network } from "../record-network";
import { Applied, Expired, Rejected, Sealed } from "./Chain.server";
import { StoreFailure } from "./Directory.server";
import {
  authorizeExternalOrder,
  linkCleaned,
  ordersOnUnclaimedFunds,
  scopeAt,
} from "./asset-order-links.server";
import {
  type AssetAuthorized,
  AssetConcluded,
  type AssetOrderRow,
  type AssetProposed,
  type ConclusionColumns,
  type StoredAssetOrder,
  type StoredOrder,
  StoredOrderJson,
  readRow,
} from "./asset-order-records.server";
import { SlotOccupied, WalletInactive, walletLock } from "./slot.server";
import {
  pruneExpiredAssetOrderDrafts,
  stuckAssetOrders,
  receivedLinksToClean,
} from "./asset-order-sweep.server";
import { assetOrders, transfers, wallets } from "./tables.server";
import type { Transaction } from "./transaction.server";
import {
  CleanUpReceivedLink,
  ReconcileAssetOrder,
  WorkQueue,
  announcer,
} from "./work-queue.server";

export {
  AssetAuthorized,
  AssetConcluded,
  AssetOrderJson,
  AssetProposed,
  type ConcludedReceipt,
  ReceiveLinkExternal,
  type StoredAssetOrder,
  StoredExternalOrder,
  type StoredOrder,
  StoredOrderJson,
  assetPending,
  externalPending,
  orderPending,
  toStoredExternalOrder,
} from "./asset-order-records.server";

export class AssetOrders extends Context.Service<
  AssetOrders,
  {
    find(
      id: AssetOrderId,
    ): Effect.Effect<Option.Option<StoredAssetOrder>, StoreFailure>;

    inFlightFor(
      wallet: AccountAddress,
    ): Effect.Effect<
      Option.Option<AssetAuthorized & { readonly order: AssetOrder }>,
      StoreFailure
    >;
    propose(
      order: StoredOrder,
      request: SigningRequest,
    ): Effect.Effect<StoredAssetOrder, StoreFailure>;
    redraft(
      proposed: AssetProposed,
      request: SigningRequest,
    ): Effect.Effect<StoredAssetOrder, StoreFailure>;
    authorize(
      proposed: AssetProposed,
      sealed: Sealed,
    ): Effect.Effect<
      StoredAssetOrder | SlotOccupied | WalletInactive,
      StoreFailure
    >;
    authorizeExternal(
      proposed: AssetProposed,
      sealed: Sealed,
    ): Effect.Effect<StoredAssetOrder | SlotOccupied, StoreFailure>;

    conclude(
      id: AssetOrderId,
      settlement: Applied | Rejected | Expired,
    ): Effect.Effect<AssetConcluded, StoreFailure>;
    inFlight(
      runStartedAt: DateTime.Utc,
    ): Effect.Effect<ReadonlyArray<AssetAuthorized>, StoreFailure>;
    readonly pruneExpiredDrafts: Effect.Effect<void, StoreFailure>;

    onUnclaimedFunds(
      unclaimedFunds: UnclaimedFundsId,
    ): Effect.Effect<ReadonlyArray<StoredAssetOrder>, StoreFailure>;

    receivedLinksToClean(
      runStartedAt: DateTime.Utc,
    ): Effect.Effect<ReadonlyArray<AssetConcluded>, StoreFailure>;

    linkCleaned(id: AssetOrderId): Effect.Effect<void, StoreFailure>;
  }
>()("@workspace/wallet/server/AssetOrders") {
  static readonly layer = Layer.effect(
    AssetOrders,
    Effect.gen(function* () {
      const db = yield* Database;

      const decode = (row: AssetOrderRow) =>
        Effect.try({
          try: () => readRow(row),
          catch: (cause) => new StoreFailure({ cause }),
        });

      const signed = Effect.fn("AssetOrders.signed")(function* (
        row: AssetOrderRow,
      ) {
        const stored = yield* decode(row);

        if (!Predicate.isTagged(stored, "AssetAuthorized"))
          return yield* new StoreFailure({
            cause: new Error("Invalid in-flight state"),
          });

        return stored;
      });

      const find = Effect.fn("AssetOrders.find")(function* (id: AssetOrderId) {
        const now = yield* Clock.currentTimeMillis;

        const rows = yield* db
          .select()
          .from(assetOrders)
          .where(and(scopeAt(now), eq(assetOrders.id, id)));

        return rows[0] ? Option.some(yield* decode(rows[0])) : Option.none();
      });

      const found = Effect.fn("AssetOrders.found")(function* (
        id: AssetOrderId,
      ) {
        const existing = yield* find(id);

        if (Option.isNone(existing))
          return yield* new StoreFailure({
            cause: new Error("Asset order belongs to another network epoch"),
          });

        return existing.value;
      });

      const inFlightFor = Effect.fn("AssetOrders.inFlightFor")(function* (
        wallet: AccountAddress,
      ) {
        const now = yield* Clock.currentTimeMillis;

        const rows = yield* db
          .select()
          .from(assetOrders)
          .where(
            and(
              scopeAt(now),
              eq(assetOrders.wallet, wallet),
              eq(assetOrders.status, "authorized"),
            ),
          );

        if (!rows[0]) return Option.none();

        const stored = yield* signed(rows[0]);

        if (!(stored.order instanceof AssetOrder))
          return yield* new StoreFailure({
            cause: new Error("Wallet in-flight row is not a wallet order"),
          });

        return Option.some({ ...stored, order: stored.order });
      });

      const propose = Effect.fn("AssetOrders.propose")(function* (
        order: StoredOrder,
        request: SigningRequest,
      ) {
        const now = yield* Clock.currentTimeMillis;

        const value = {
          id: order.id,
          wallet: order instanceof AssetOrder ? order.wallet : null,
          order: Schema.encodeSync(StoredOrderJson)(order),
          balanceId: order.action.unclaimedFunds,
          network,
          testnetEpoch: epochAt(now),
          envelope: request.envelope,
          expiresAt: DateTime.toDateUtc(request.expiresAt),
        };

        const rows = yield* db
          .insert(assetOrders)
          .values({ ...value, status: "proposed" })
          .onConflictDoUpdate({
            target: assetOrders.id,
            set: {
              envelope: value.envelope,
              expiresAt: value.expiresAt,
            },
            setWhere: and(
              scopeAt(now),
              eq(assetOrders.status, "proposed"),
              eq(assetOrders.order, value.order),
              lt(
                assetOrders.expiresAt,
                DateTime.toDateUtc(
                  DateTime.makeUnsafe(now + approvalMargin * 1000),
                ),
              ),
            ),
          })
          .returning();

        return rows[0] ? yield* decode(rows[0]) : yield* found(order.id);
      });

      const redraft = Effect.fn("AssetOrders.redraft")(function* (
        proposed: AssetProposed,
        request: SigningRequest,
      ) {
        const now = yield* Clock.currentTimeMillis;

        const rows = yield* db
          .update(assetOrders)
          .set({
            envelope: request.envelope,
            expiresAt: DateTime.toDateUtc(request.expiresAt),
          })
          .where(
            and(
              scopeAt(now),
              eq(assetOrders.id, proposed.order.id),
              eq(assetOrders.status, "proposed"),
              eq(assetOrders.envelope, proposed.request.envelope),
            ),
          )
          .returning();

        return rows[0]
          ? yield* decode(rows[0])
          : yield* found(proposed.order.id);
      });

      const authorize = (proposed: AssetProposed, sealed: Sealed) =>
        db.transaction((tx) =>
          Effect.gen(function* () {
            if (!(proposed.order instanceof AssetOrder))
              return yield* new StoreFailure({
                cause: new Error(
                  "Wallet authorization requires a wallet order",
                ),
              });

            const { id, wallet } = proposed.order;

            yield* tx.execute(walletLock(wallet));

            const owner = yield* tx
              .select({
                status: wallets.status,
                enrollmentReceiveOrderId: wallets.enrollmentReceiveOrderId,
              })
              .from(wallets)
              .where(
                and(eq(wallets.network, network), eq(wallets.address, wallet)),
              );

            if (owner[0]?.status !== "active") return new WalletInactive();

            const lockedAt = yield* Clock.currentTimeMillis;
            const scope = scopeAt(lockedAt);

            const held = yield* tx
              .select({ id: assetOrders.id })
              .from(assetOrders)
              .where(
                and(
                  scope,
                  eq(assetOrders.wallet, wallet),
                  eq(assetOrders.status, "authorized"),
                ),
              );

            const paying = yield* tx
              .select({ id: transfers.id })
              .from(transfers)
              .where(
                and(
                  eq(transfers.network, network),
                  eq(transfers.testnetEpoch, epochAt(lockedAt)),
                  eq(transfers.sender, wallet),
                  eq(transfers.status, "authorized"),
                ),
              );

            if (paying[0] || (held[0] && held[0].id !== id))
              return new SlotOccupied();

            const commitAt = yield* Clock.currentTimeMillis;

            const written = yield* tx
              .update(assetOrders)
              .set({
                status: "authorized",
                enrollmentReceive:
                  Predicate.isTagged(proposed.order.action, "ReceiveLink") &&
                  owner[0].enrollmentReceiveOrderId === id,
                envelope: sealed.envelope,
                hash: sealed.hash,
              })
              .where(
                and(
                  scope,
                  eq(assetOrders.id, id),
                  eq(assetOrders.status, "proposed"),
                  eq(assetOrders.envelope, proposed.request.envelope),
                  gt(
                    assetOrders.expiresAt,
                    DateTime.toDateUtc(
                      DateTime.makeUnsafe(commitAt + approvalMargin * 1000),
                    ),
                  ),
                ),
              )
              .returning();

            if (written[0]) return yield* decode(written[0]);

            const fresh = yield* tx
              .select()
              .from(assetOrders)
              .where(and(scope, eq(assetOrders.id, id)));

            if (!fresh[0])
              return yield* new StoreFailure({
                cause: new Error("Asset order disappeared"),
              });

            return yield* decode(fresh[0]);
          }),
        );

      const closeUnclaimedFunds = (
        tx: Transaction,
        unclaimedFunds: UnclaimedFundsId,
        now: DateTime.Utc,
      ) =>
        tx
          .update(transfers)
          .set({ balanceClosedAt: DateTime.toDateUtc(now) })
          .where(
            and(
              eq(transfers.balanceId, unclaimedFunds),
              isNull(transfers.balanceClosedAt),
            ),
          )
          .pipe(Effect.asVoid);

      const applied = (
        tx: Transaction,
        row: AssetOrderRow,
        now: DateTime.Utc,
      ) =>
        closeUnclaimedFunds(
          tx,
          Schema.decodeSync(StoredOrderJson)(row.order).action.unclaimedFunds,
          now,
        );

      const conclude = Effect.fn("AssetOrders.conclude")(function* (
        id: AssetOrderId,
        settlement: Applied | Rejected | Expired,
      ) {
        const now = yield* DateTime.now;
        const nowDate = DateTime.toDateUtc(now);
        const scope = scopeAt(DateTime.toEpochMillis(now));

        const values = Match.valueTags(settlement, {
          Applied: (evidence): ConclusionColumns => ({
            status: "settled",
            concludedAt: DateTime.toDateUtc(evidence.at),
            failure: null,
          }),
          Rejected: (): ConclusionColumns => ({
            status: "failed",
            concludedAt: nowDate,
            failure: "rejected",
          }),
          Expired: (): ConclusionColumns => ({
            status: "failed",
            concludedAt: nowDate,
            failure: "expired",
          }),
        });

        const written = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const rows = yield* tx
              .update(assetOrders)
              .set(values)
              .where(
                and(
                  scope,
                  eq(assetOrders.id, id),
                  eq(assetOrders.status, "authorized"),
                ),
              )
              .returning();

            if (rows[0] && values.status === "settled")
              yield* applied(tx, rows[0], now);

            return rows[0];
          }),
        );

        const current = written
          ? yield* decode(written)
          : Option.getOrUndefined(yield* find(id));

        if (!Predicate.isTagged(current, "AssetConcluded"))
          return yield* new StoreFailure({
            cause: new Error("Asset order is not concluded"),
          });

        return current;
      });

      const wrap = <A, E>(program: Effect.Effect<A, E>) =>
        program.pipe(Effect.mapError((cause) => new StoreFailure({ cause })));

      const announce = announcer(yield* WorkQueue);

      const announceAuthorized = (
        outcome: StoredAssetOrder | SlotOccupied | WalletInactive,
      ) =>
        Predicate.isTagged(outcome, "AssetAuthorized")
          ? announce(new ReconcileAssetOrder({ id: outcome.order.id }))
          : Effect.void;

      const announceConcluded = (concluded: AssetConcluded) =>
        (Predicate.isTagged(concluded.order.action, "ReceiveLink") ||
          Predicate.isTagged(concluded.order.action, "ReceiveLinkExternal")) &&
        (Predicate.isTagged(concluded.receipt, "AssetSettled") ||
          Predicate.isTagged(concluded.receipt, "ExternalLinkSettled"))
          ? announce(new CleanUpReceivedLink({ id: concluded.order.id }))
          : Effect.void;

      return AssetOrders.of({
        find: (id) => wrap(find(id)),
        inFlightFor: (wallet) => wrap(inFlightFor(wallet)),
        propose: (order, request) => wrap(propose(order, request)),
        redraft: (proposed, request) => wrap(redraft(proposed, request)),
        authorize: (proposed, sealed) =>
          wrap(
            authorize(proposed, sealed).pipe(Effect.tap(announceAuthorized)),
          ),
        authorizeExternal: (proposed, sealed) =>
          wrap(
            authorizeExternalOrder(proposed, sealed, decode).pipe(
              Effect.provideService(Database, db),
              Effect.tap(announceAuthorized),
            ),
          ),
        conclude: (id, settlement) =>
          wrap(conclude(id, settlement).pipe(Effect.tap(announceConcluded))),
        inFlight: (runStartedAt) =>
          wrap(
            stuckAssetOrders(runStartedAt, signed).pipe(
              Effect.provideService(Database, db),
            ),
          ),
        pruneExpiredDrafts: wrap(
          pruneExpiredAssetOrderDrafts().pipe(
            Effect.provideService(Database, db),
          ),
        ),
        onUnclaimedFunds: (unclaimedFunds) =>
          wrap(
            ordersOnUnclaimedFunds(unclaimedFunds, decode).pipe(
              Effect.provideService(Database, db),
            ),
          ),
        receivedLinksToClean: (runStartedAt) =>
          wrap(
            receivedLinksToClean(runStartedAt, decode).pipe(
              Effect.provideService(Database, db),
            ),
          ),
        linkCleaned: (id) =>
          wrap(linkCleaned(id).pipe(Effect.provideService(Database, db))),
      });
    }),
  );
}
