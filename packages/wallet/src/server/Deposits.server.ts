import { Database } from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  PositiveAmount,
  baseAsset,
  precisionOf,
} from "../contract";
import { assetColumns, epochAt, network } from "../record-network";
import { AssetEvent } from "./chain-deposits.server";
import { StoreFailure } from "./Directory.server";
import {
  assetOrders,
  depositCursors,
  deposits,
  transfers,
  wallets,
} from "./tables.server";

export interface DepositCursor {
  readonly feed: string;
  readonly cursor: string;
  readonly ledger: number;
  readonly closedAt: Option.Option<DateTime.Utc>;
}

export class Deposits extends Context.Service<
  Deposits,
  {
    cursor(
      feed: string,
    ): Effect.Effect<Option.Option<DepositCursor>, StoreFailure>;
    store(
      events: ReadonlyArray<AssetEvent>,
      advance: Option.Option<DepositCursor>,
    ): Effect.Effect<void, StoreFailure>;
  }
>()("@workspace/wallet/server/Deposits") {
  static readonly layer = Layer.effect(
    Deposits,
    Effect.gen(function* () {
      const db = yield* Database;

      const wrap = <A, E>(program: Effect.Effect<A, E>) =>
        program.pipe(Effect.mapError((cause) => new StoreFailure({ cause })));

      const cursor = (feed: string) =>
        wrap(
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) =>
              db
                .select()
                .from(depositCursors)
                .where(
                  and(
                    eq(depositCursors.network, network),
                    eq(depositCursors.testnetEpoch, epochAt(now)),
                    eq(depositCursors.contractId, feed),
                  ),
                ),
            ),
            Effect.map((rows) =>
              Option.fromUndefinedOr(rows[0]).pipe(
                Option.map((row): DepositCursor => ({
                  feed,
                  cursor: row.cursor,
                  ledger: row.ledger,
                  closedAt: Option.fromNullishOr(row.closedAt).pipe(
                    Option.map(DateTime.fromDateUnsafe),
                  ),
                })),
              ),
            ),
          ),
        );

      const store = (
        events: ReadonlyArray<AssetEvent>,
        advance: Option.Option<DepositCursor>,
      ) =>
        wrap(
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) =>
              db.transaction((tx) =>
                Effect.gen(function* () {
                  const epoch = epochAt(now);
                  const payments = events.filter(AssetEvent.$is("Payment"));

                  const claims = events.filter(
                    AssetEvent.$is("UnclaimedFundsClaim"),
                  );

                  const recipients = [
                    ...new Set(payments.map((payment) => payment.to)),
                  ];

                  const known =
                    recipients.length === 0
                      ? []
                      : yield* tx
                          .select({ address: wallets.address })
                          .from(wallets)
                          .where(
                            and(
                              eq(wallets.network, network),
                              eq(wallets.testnetEpoch, epoch),
                              inArray(wallets.address, recipients),
                            ),
                          );

                  const addressed = payments.filter((payment) =>
                    known.some((wallet) => wallet.address === payment.to),
                  );

                  const hashes = [
                    ...new Set(addressed.map((payment) => payment.hash)),
                  ];

                  const orchidHashes =
                    hashes.length === 0
                      ? []
                      : [
                          ...(yield* tx
                            .select({ hash: transfers.hash })
                            .from(transfers)
                            .where(inArray(transfers.hash, hashes))),
                          ...(yield* tx
                            .select({ hash: assetOrders.hash })
                            .from(assetOrders)
                            .where(inArray(assetOrders.hash, hashes))),
                        ];

                  const rows = addressed.flatMap((payment) => {
                    const sender = Schema.decodeOption(AccountAddress)(
                      payment.from,
                    );

                    const amount = Schema.decodeOption(PositiveAmount)(
                      payment.amount.toString(),
                    ).pipe(
                      Option.filter(
                        (units) => units <= precisionOf(baseAsset).maximum,
                      ),
                    );

                    return Option.isSome(sender) &&
                      Option.isSome(amount) &&
                      !orchidHashes.some((own) => own.hash === payment.hash)
                      ? [
                          {
                            network,
                            testnetEpoch: epoch,
                            eventId: payment.eventId,
                            wallet: payment.to,
                            ...assetColumns(baseAsset),
                            amount: amount.value,
                            sender: sender.value,
                            hash: payment.hash,
                            ledger: payment.ledger,
                            closedAt: DateTime.toDateUtc(payment.closedAt),
                          },
                        ]
                      : [];
                  });

                  if (rows.length > 0)
                    yield* tx
                      .insert(deposits)
                      .values(rows)
                      .onConflictDoNothing({
                        target: [
                          deposits.network,
                          deposits.testnetEpoch,
                          deposits.eventId,
                        ],
                      });

                  const open =
                    claims.length === 0
                      ? []
                      : yield* tx
                          .select({ unclaimedFunds: transfers.balanceId })
                          .from(transfers)
                          .where(
                            and(
                              eq(transfers.network, network),
                              eq(transfers.testnetEpoch, epoch),
                              eq(transfers.status, "settled"),
                              isNull(transfers.balanceClosedAt),
                              inArray(
                                transfers.balanceId,
                                claims.map((claim) => claim.unclaimedFunds),
                              ),
                            ),
                          );

                  yield* Effect.forEach(
                    claims.filter((claim) =>
                      open.some(
                        (entry) =>
                          entry.unclaimedFunds === claim.unclaimedFunds,
                      ),
                    ),
                    (claim) =>
                      tx
                        .update(transfers)
                        .set({
                          balanceClosedAt: DateTime.toDateUtc(claim.closedAt),
                        })
                        .where(
                          and(
                            eq(transfers.network, network),
                            eq(transfers.testnetEpoch, epoch),
                            eq(transfers.balanceId, claim.unclaimedFunds),
                            isNull(transfers.balanceClosedAt),
                          ),
                        ),
                    { discard: true },
                  );

                  if (Option.isSome(advance))
                    yield* tx
                      .insert(depositCursors)
                      .values({
                        network,
                        testnetEpoch: epoch,
                        contractId: advance.value.feed,
                        cursor: advance.value.cursor,
                        ledger: advance.value.ledger,
                        closedAt: Option.getOrNull(
                          Option.map(
                            advance.value.closedAt,
                            DateTime.toDateUtc,
                          ),
                        ),
                      })
                      .onConflictDoUpdate({
                        target: [
                          depositCursors.network,
                          depositCursors.testnetEpoch,
                          depositCursors.contractId,
                        ],
                        set: {
                          cursor: advance.value.cursor,
                          ledger: advance.value.ledger,
                          closedAt: Option.getOrNull(
                            Option.map(
                              advance.value.closedAt,
                              DateTime.toDateUtc,
                            ),
                          ),
                        },
                      });
                }),
              ),
            ),
          ),
        );

      return Deposits.of({ cursor, store });
    }),
  );
}
