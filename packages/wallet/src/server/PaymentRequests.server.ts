import { Database } from "@workspace/db";
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { isSqlError } from "effect/sql/SqlError";
import {
  type AccountAddress,
  AssetCode,
  AssetId,
  type CancelPaymentRequestStep,
  type CreatePaymentRequestStep,
  NeedsReopening,
  type NewPaymentRequest,
  NotOpened,
  OpenPaymentRequests,
  type OpenPaymentRequestsStep,
  type PaidRequest,
  PaymentRequestAssetUnsupported,
  PaymentRequestBeingPaid,
  PaymentRequestCancelled,
  PaymentRequestId,
  PaymentRequestLimitReached,
  PaymentRequestNote,
  PaymentRequestNotFound,
  PaymentRequestOpen,
  PaymentRequestPaid,
  PaymentRequestPaymentTaken,
  type PaymentRequestPort,
  type PaymentRequestStep,
  PositiveAmount,
  type Profile,
  TransferId,
  Username,
  baseAsset,
  sameAsset,
} from "../contract";
import { openPaymentRequestQuota } from "../policy";
import { epochAt, network } from "../record-network";
import { Directory } from "./Directory.server";
import { Principal } from "./Principal.server";
import { walletLock } from "./slot.server";
import { StoreFailure } from "./store-failure.server";
import { paymentRequests, usernames } from "./tables.server";

type PaymentRequestRow = typeof paymentRequests.$inferSelect;

const requestOf = (row: PaymentRequestRow) => ({
  id: Schema.decodeSync(PaymentRequestId)(row.id),
  requester: Schema.decodeSync(Username)(row.requester),
  asset: {
    id: Schema.decodeSync(AssetId)(row.assetId),
    code: Schema.decodeSync(AssetCode)(row.assetCode),
  },
  amount: Schema.decodeSync(PositiveAmount)(row.amount.toString()),
  note:
    row.note === null
      ? undefined
      : Schema.decodeSync(PaymentRequestNote)(row.note),
  createdAt: DateTime.fromDateUnsafe(row.createdAt),
});

const stepOf = (row: PaymentRequestRow) => {
  const request = requestOf(row);

  switch (row.status) {
    case "open":
      return new PaymentRequestOpen(request);
    case "paid":
      return new PaymentRequestPaid(request);
    case "cancelled":
      return new PaymentRequestCancelled(request);
  }
};

const stored = <A, E>(query: Effect.Effect<A, E>) =>
  query.pipe(Effect.mapError((cause) => new StoreFailure({ cause })));

const sameRequest = (
  row: PaymentRequestRow,
  requester: Username,
  request: NewPaymentRequest,
) =>
  row.requester === requester &&
  row.assetId === request.asset.id &&
  row.assetCode === request.asset.code &&
  row.amount === request.amount &&
  row.note === (request.note ?? null);

const paymentIndex = "payment_requests_payment";

const violatesPaymentIndex = (error: EffectDrizzleQueryError) =>
  Cause.isCause(error.cause) &&
  Option.exists(
    Cause.findErrorOption(error.cause),
    (failure) =>
      isSqlError(failure) &&
      Predicate.isTagged(failure.reason, "UniqueViolation") &&
      failure.reason.constraint === paymentIndex,
  );

export interface RequestBinding {
  readonly payment: string;
  readonly expiresAt: Option.Option<DateTime.Utc>;
}

export interface InspectedRequest {
  readonly step:
    | PaymentRequestOpen
    | PaymentRequestPaid
    | PaymentRequestCancelled;
  readonly binding: Option.Option<RequestBinding>;
}

const inspectedOf = (row: PaymentRequestRow): InspectedRequest => ({
  step: stepOf(row),
  binding: Option.map(Option.fromNullishOr(row.payment), (payment) => ({
    payment,
    expiresAt: Option.map(
      Option.fromNullishOr(row.paymentExpiresAt),
      DateTime.fromDateUnsafe,
    ),
  })),
});

export class PaymentRequests extends Context.Service<
  PaymentRequests,
  PaymentRequestPort<StoreFailure> & {
    inspect(
      id: PaymentRequestId,
    ): Effect.Effect<Option.Option<InspectedRequest>, StoreFailure>;
    openBound(
      address: AccountAddress,
    ): Effect.Effect<ReadonlyArray<PaymentRequestId>, StoreFailure>;
    paidBy(
      payments: ReadonlyArray<TransferId>,
    ): Effect.Effect<ReadonlyArray<PaidRequest>, StoreFailure>;
    bind(
      id: PaymentRequestId,
      payment: TransferId,
      expiresAt: DateTime.Utc,
    ): Effect.Effect<boolean | PaymentRequestPaymentTaken, StoreFailure>;
    release(
      id: PaymentRequestId,
      payment: TransferId,
    ): Effect.Effect<void, StoreFailure>;
    markPaid(
      id: PaymentRequestId,
      payment: TransferId,
    ): Effect.Effect<void, StoreFailure>;
  }
>()("@workspace/wallet/server/PaymentRequests") {
  static readonly serviceLayer = Layer.effect(
    PaymentRequests,
    Effect.gen(function* () {
      const db = yield* Database;
      const directory = yield* Directory;

      const current = Effect.map(Clock.currentTimeMillis, (now) =>
        and(
          eq(paymentRequests.network, network),
          eq(paymentRequests.testnetEpoch, epochAt(now)),
        ),
      );

      const find = Effect.fn("PaymentRequests.find")(function* (
        id: PaymentRequestId,
        requester?: Username,
      ) {
        const scope = yield* current;

        const rows = yield* stored(
          db
            .select()
            .from(paymentRequests)
            .where(
              and(
                scope,
                eq(paymentRequests.id, id),
                requester === undefined
                  ? undefined
                  : eq(paymentRequests.requester, requester),
              ),
            ),
        );

        return Option.fromNullishOr(rows[0]);
      });

      const openFrom = (requester: Username) =>
        and(
          eq(paymentRequests.requester, requester),
          eq(paymentRequests.status, "open"),
        );

      const requesterAt = Effect.fn("PaymentRequests.requesterAt")(function* (
        address: AccountAddress,
      ): Effect.fn.Return<
        { readonly profile: Profile; readonly recovered: boolean } | NotOpened,
        StoreFailure
      > {
        const wallet = yield* directory.byAddress(address);

        if (Option.isNone(wallet) || wallet.value.status === "opening")
          return new NotOpened();

        return {
          profile: yield* directory.profile(wallet.value),
          recovered: wallet.value.status === "recovered",
        };
      });

      const create = Effect.fn("PaymentRequests.create")(function* (
        address: AccountAddress,
        request: NewPaymentRequest,
      ): Effect.fn.Return<CreatePaymentRequestStep, StoreFailure> {
        const requester = yield* requesterAt(address);

        if (requester instanceof NotOpened) return requester;

        const { profile, recovered } = requester;

        if (recovered) return new NeedsReopening({ profile });

        if (!sameAsset(request.asset, baseAsset))
          return new PaymentRequestAssetUnsupported();

        const now = yield* Clock.currentTimeMillis;
        const scope = yield* current;

        const written = yield* stored(
          db.transaction((tx) =>
            Effect.gen(function* () {
              yield* tx.execute(walletLock(address));

              const own = tx
                .select()
                .from(paymentRequests)
                .where(
                  and(
                    scope,
                    eq(paymentRequests.id, request.id),
                    eq(paymentRequests.requester, profile.username),
                  ),
                );

              const [replayed] = yield* own;

              if (replayed) return replayed;

              const [opened] = yield* tx
                .select({ total: count() })
                .from(paymentRequests)
                .where(and(scope, openFrom(profile.username)));

              if ((opened?.total ?? 0) >= openPaymentRequestQuota)
                return new PaymentRequestLimitReached({
                  limit: openPaymentRequestQuota,
                });

              yield* tx
                .insert(paymentRequests)
                .values({
                  id: request.id,
                  requester: profile.username,
                  network,
                  testnetEpoch: epochAt(now),
                  assetId: request.asset.id,
                  assetCode: request.asset.code,
                  amount: request.amount,
                  note: request.note ?? null,
                  status: "open",
                })
                .onConflictDoNothing();

              const [inserted] = yield* own;

              return inserted;
            }),
          ),
        );

        if (written instanceof PaymentRequestLimitReached) return written;

        if (!written || !sameRequest(written, profile.username, request))
          return yield* new StoreFailure({
            cause: new Error(
              "Payment request id cannot identify a different request",
            ),
          });

        return stepOf(written);
      });

      const read = Effect.fn("PaymentRequests.read")(function* (
        id: PaymentRequestId,
      ): Effect.fn.Return<PaymentRequestStep, StoreFailure> {
        const found = yield* find(id);

        return Option.match(found, {
          onNone: () => new PaymentRequestNotFound(),
          onSome: stepOf,
        });
      });

      const open = Effect.fn("PaymentRequests.open")(function* (
        address: AccountAddress,
      ): Effect.fn.Return<OpenPaymentRequestsStep, StoreFailure> {
        const requester = yield* requesterAt(address);

        if (requester instanceof NotOpened) return requester;

        const scope = yield* current;

        const rows = yield* stored(
          db
            .select()
            .from(paymentRequests)
            .where(and(scope, openFrom(requester.profile.username)))
            .orderBy(desc(paymentRequests.createdAt), paymentRequests.id),
        );

        return new OpenPaymentRequests({
          requests: rows.map((row) => new PaymentRequestOpen(requestOf(row))),
        });
      });

      const cancel = Effect.fn("PaymentRequests.cancel")(function* (
        address: AccountAddress,
        id: PaymentRequestId,
      ): Effect.fn.Return<CancelPaymentRequestStep, StoreFailure> {
        const requester = yield* requesterAt(address);

        if (requester instanceof NotOpened) return requester;

        const { username } = requester.profile;
        const scope = yield* current;
        const now = yield* Clock.currentTimeMillis;

        const [cancelled] = yield* stored(
          db
            .update(paymentRequests)
            .set({ status: "cancelled", cancelledAt: new Date(now) })
            .where(
              and(
                scope,
                eq(paymentRequests.id, id),
                eq(paymentRequests.requester, username),
                eq(paymentRequests.status, "open"),
                isNull(paymentRequests.payment),
              ),
            )
            .returning(),
        );

        if (cancelled) return new PaymentRequestCancelled(requestOf(cancelled));

        const found = yield* find(id, username);

        if (Option.isNone(found)) return new PaymentRequestNotFound();

        const settled = stepOf(found.value);

        return settled instanceof PaymentRequestOpen
          ? new PaymentRequestBeingPaid()
          : settled;
      });

      const inspect = Effect.fn("PaymentRequests.inspect")(function* (
        id: PaymentRequestId,
      ) {
        return Option.map(yield* find(id), inspectedOf);
      });

      const openBound = Effect.fn("PaymentRequests.openBound")(function* (
        address: AccountAddress,
      ) {
        const scope = yield* current;

        const rows = yield* stored(
          db
            .select({ id: paymentRequests.id })
            .from(paymentRequests)
            .innerJoin(
              usernames,
              eq(usernames.username, paymentRequests.requester),
            )
            .where(
              and(
                scope,
                eq(usernames.address, address),
                eq(paymentRequests.status, "open"),
                isNotNull(paymentRequests.payment),
              ),
            ),
        );

        return rows.map((row) => Schema.decodeSync(PaymentRequestId)(row.id));
      });

      const paidBy = Effect.fn("PaymentRequests.paidBy")(function* (
        payments: ReadonlyArray<TransferId>,
      ) {
        if (payments.length === 0) return [];

        const scope = yield* current;

        const rows = yield* stored(
          db
            .select(getTableColumns(paymentRequests))
            .from(paymentRequests)
            .where(
              and(
                scope,
                eq(paymentRequests.status, "paid"),
                inArray(paymentRequests.payment, [...payments]),
              ),
            ),
        );

        return rows.flatMap((row) =>
          row.payment === null
            ? []
            : [
                {
                  payment: Schema.decodeSync(TransferId)(row.payment),
                  request: new PaymentRequestPaid(requestOf(row)),
                },
              ],
        );
      });

      const bindingTo = (id: PaymentRequestId, payment: TransferId) =>
        Effect.map(current, (scope) =>
          and(
            scope,
            eq(paymentRequests.id, id),
            eq(paymentRequests.status, "open"),
            eq(paymentRequests.payment, payment),
          ),
        );

      const bind = Effect.fn("PaymentRequests.bind")(function* (
        id: PaymentRequestId,
        payment: TransferId,
        expiresAt: DateTime.Utc,
      ) {
        const scope = yield* current;

        const bound = yield* db
          .update(paymentRequests)
          .set({ payment, paymentExpiresAt: DateTime.toDateUtc(expiresAt) })
          .where(
            and(
              scope,
              eq(paymentRequests.id, id),
              eq(paymentRequests.status, "open"),
              isNull(paymentRequests.payment),
            ),
          )
          .returning({ id: paymentRequests.id })
          .pipe(
            Effect.map((rows) => rows.length > 0),
            Effect.catchIf(violatesPaymentIndex, () =>
              Effect.succeed(new PaymentRequestPaymentTaken()),
            ),
            stored,
          );

        if (bound !== false) return bound;

        const held = yield* stored(
          db
            .select({ id: paymentRequests.id })
            .from(paymentRequests)
            .where(yield* bindingTo(id, payment)),
        );

        return held.length > 0;
      });

      const release = Effect.fn("PaymentRequests.release")(function* (
        id: PaymentRequestId,
        payment: TransferId,
      ) {
        yield* stored(
          db
            .update(paymentRequests)
            .set({ payment: null, paymentExpiresAt: null })
            .where(yield* bindingTo(id, payment)),
        );
      });

      const markPaid = Effect.fn("PaymentRequests.markPaid")(function* (
        id: PaymentRequestId,
        payment: TransferId,
      ) {
        const now = yield* Clock.currentTimeMillis;

        yield* stored(
          db
            .update(paymentRequests)
            .set({
              status: "paid",
              paidAt: new Date(now),
              paymentExpiresAt: null,
            })
            .where(yield* bindingTo(id, payment)),
        );
      });

      return PaymentRequests.of({
        create,
        read,
        open,
        cancel,
        inspect,
        openBound,
        paidBy,
        bind,
        release,
        markPaid,
      });
    }),
  );
  static readonly layer = PaymentRequests.serviceLayer.pipe(
    Layer.provideMerge(Principal.layer),
    Layer.provide(Directory.layer),
  );
}
