import { Database } from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
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
import type { DepositPage, DepositPosition } from "./chain-deposits.server";
import { StoreFailure } from "./Directory.server";
import {
  assetOrders,
  depositCursors,
  deposits,
  transfers,
  wallets,
} from "./tables.server";

export interface DepositCursor {
  readonly position: Option.Option<DepositPosition>;
  readonly scannedAt: Option.Option<DateTime.Utc>;
}

export interface WalletToScan {
  readonly wallet: AccountAddress;
  readonly cursor: DepositCursor;
}

type CursorRow = Pick<
  typeof depositCursors.$inferSelect,
  "cursor" | "ledger" | "scannedAt"
>;

const cursorOf = (row: CursorRow | undefined): DepositCursor => ({
  position: Option.fromUndefinedOr(row).pipe(
    Option.flatMap(({ cursor, ledger }) =>
      cursor === null || ledger === null
        ? Option.none()
        : Option.some({ cursor, ledger }),
    ),
  ),
  scannedAt: Option.fromUndefinedOr(row).pipe(
    Option.flatMap(({ scannedAt }) => Option.fromNullOr(scannedAt)),
    Option.map(DateTime.fromDateUnsafe),
  ),
});

export class Deposits extends Context.Service<
  Deposits,
  {
    cursor(wallet: AccountAddress): Effect.Effect<DepositCursor, StoreFailure>;
    readonly walletsToScan: Effect.Effect<
      ReadonlyArray<WalletToScan>,
      StoreFailure
    >;
    record(
      wallet: AccountAddress,
      page: DepositPage,
    ): Effect.Effect<void, StoreFailure>;
    scanned(
      wallet: AccountAddress,
      at: DateTime.Utc,
    ): Effect.Effect<void, StoreFailure>;
  }
>()("@workspace/wallet/server/Deposits") {
  static readonly layer = Layer.effect(
    Deposits,
    Effect.gen(function* () {
      const db = yield* Database;

      const wrap = <A, E>(program: Effect.Effect<A, E>) =>
        program.pipe(Effect.mapError((cause) => new StoreFailure({ cause })));

      const currentEpoch = Effect.map(Clock.currentTimeMillis, epochAt);

      const cursor = (wallet: AccountAddress) =>
        wrap(
          currentEpoch.pipe(
            Effect.flatMap((epoch) =>
              db
                .select()
                .from(depositCursors)
                .where(
                  and(
                    eq(depositCursors.network, network),
                    eq(depositCursors.testnetEpoch, epoch),
                    eq(depositCursors.wallet, wallet),
                  ),
                ),
            ),
            Effect.map((rows) => cursorOf(rows[0])),
          ),
        );

      const walletsToScan = wrap(
        currentEpoch.pipe(
          Effect.flatMap((epoch) =>
            db
              .select({
                wallet: wallets.address,
                cursor: depositCursors.cursor,
                ledger: depositCursors.ledger,
                scannedAt: depositCursors.scannedAt,
              })
              .from(wallets)
              .leftJoin(
                depositCursors,
                and(
                  eq(depositCursors.network, wallets.network),
                  eq(depositCursors.testnetEpoch, wallets.testnetEpoch),
                  eq(depositCursors.wallet, wallets.address),
                ),
              )
              .where(
                and(
                  eq(wallets.network, network),
                  eq(wallets.testnetEpoch, epoch),
                  eq(wallets.status, "active"),
                ),
              )
              .orderBy(
                sql`${depositCursors.scannedAt} asc nulls first`,
                asc(wallets.address),
              ),
          ),
          Effect.map((rows) =>
            rows.map((row): WalletToScan => ({
              wallet: Schema.decodeSync(AccountAddress)(row.wallet),
              cursor: cursorOf(row),
            })),
          ),
        ),
      );

      const record = (wallet: AccountAddress, page: DepositPage) =>
        wrap(
          currentEpoch.pipe(
            Effect.flatMap((epoch) =>
              db.transaction((tx) =>
                Effect.gen(function* () {
                  const hashes = [
                    ...new Set(page.deposits.map((deposit) => deposit.hash)),
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

                  const rows = page.deposits.flatMap((deposit) => {
                    const sender = Schema.decodeOption(AccountAddress)(
                      deposit.from,
                    );

                    const amount = Schema.decodeOption(PositiveAmount)(
                      deposit.amount.toString(),
                    ).pipe(
                      Option.filter(
                        (units) => units <= precisionOf(baseAsset).maximum,
                      ),
                    );

                    return Option.isSome(sender) &&
                      Option.isSome(amount) &&
                      !orchidHashes.some((own) => own.hash === deposit.hash)
                      ? [
                          {
                            network,
                            testnetEpoch: epoch,
                            eventId: deposit.eventId,
                            wallet,
                            ...assetColumns(baseAsset),
                            amount: amount.value,
                            sender: sender.value,
                            hash: deposit.hash,
                            ledger: deposit.ledger,
                            closedAt: DateTime.toDateUtc(deposit.closedAt),
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

                  yield* tx
                    .insert(depositCursors)
                    .values({
                      network,
                      testnetEpoch: epoch,
                      wallet,
                      cursor: page.position.cursor,
                      ledger: page.position.ledger,
                    })
                    .onConflictDoUpdate({
                      target: [
                        depositCursors.network,
                        depositCursors.testnetEpoch,
                        depositCursors.wallet,
                      ],
                      set: {
                        cursor: page.position.cursor,
                        ledger: page.position.ledger,
                      },
                    });
                }),
              ),
            ),
          ),
        );

      const scanned = (wallet: AccountAddress, at: DateTime.Utc) =>
        wrap(
          currentEpoch.pipe(
            Effect.flatMap((epoch) =>
              db
                .insert(depositCursors)
                .values({
                  network,
                  testnetEpoch: epoch,
                  wallet,
                  scannedAt: DateTime.toDateUtc(at),
                })
                .onConflictDoUpdate({
                  target: [
                    depositCursors.network,
                    depositCursors.testnetEpoch,
                    depositCursors.wallet,
                  ],
                  set: { scannedAt: DateTime.toDateUtc(at) },
                }),
            ),
            Effect.asVoid,
          ),
        );

      return Deposits.of({ cursor, walletsToScan, record, scanned });
    }),
  );
}
