import { Database } from "@workspace/db";
import {
  type AnyColumn,
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  ActivityCursor,
  type ActivityEntry,
  ActivityPage,
  AssetOrder,
  Profile,
  Username,
} from "../contract";
import { activityPageSize } from "../policy";
import { StoreFailure } from "./Directory.server";
import {
  type Closers,
  type Profiles,
  depositEntry,
  linkClaimEntry,
  receivedEntry,
  sentEntry,
} from "./activity-entries.server";
import { StoredOrderJson } from "./asset-order-records.server";
import { assetOrders, deposits, transfers, usernames } from "./tables.server";

const timeKey = (column: AnyColumn) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const cursorParts = /^(.+)_([0-9a-f-]{36})$/;

const partsOf = (cursor: ActivityCursor) => {
  const match = cursorParts.exec(cursor);

  return match?.[1] !== undefined && match[2] !== undefined
    ? Option.some({ time: match[1], id: match[2] })
    : Option.none();
};

const olderThan = (
  time: AnyColumn,
  id: AnyColumn,
  before: Option.Option<ActivityCursor>,
) =>
  Option.match(Option.flatMap(before, partsOf), {
    onNone: () => undefined,
    onSome: (parts) =>
      sql`(${time}, ${id}) < (${parts.time}::timestamptz, ${parts.id}::uuid)`,
  });

const cursorOf = (key: string, id: string) =>
  Schema.decodeSync(ActivityCursor)(`${key}_${id}`);

type Candidate = Data.TaggedEnum<{
  Sent: {
    readonly cursor: ActivityCursor;
    readonly row: typeof transfers.$inferSelect;
  };
  Received: {
    readonly cursor: ActivityCursor;
    readonly row: typeof transfers.$inferSelect;
    readonly username: string;
  };
  LinkClaim: {
    readonly cursor: ActivityCursor;
    readonly id: string;
    readonly concludedAt: Date;
    readonly transferOrder: string;
    readonly sender: string;
    readonly username: string;
  };
  Deposited: {
    readonly cursor: ActivityCursor;
    readonly row: typeof deposits.$inferSelect;
  };
}>;

const Candidate = Data.taggedEnum<Candidate>();

const isClosed = (
  row: typeof transfers.$inferSelect,
): row is typeof transfers.$inferSelect & { readonly balanceId: string } =>
  row.balanceId !== null && row.balanceClosedAt !== null;

const newestFirst = (left: Candidate, right: Candidate) =>
  left.cursor < right.cursor ? 1 : left.cursor > right.cursor ? -1 : 0;

export interface ActivityQuery {
  readonly address: AccountAddress;
  readonly destinationPrefixes: ReadonlyArray<string>;
  readonly network: string;
  readonly epoch: string;
  readonly before: ActivityCursor | undefined;
}

export const activityFor = Effect.fn("Transfers.activity")(function* ({
  address,
  destinationPrefixes,
  network,
  epoch,
  before,
}: ActivityQuery) {
  const db = yield* Database;
  const cursor = Option.fromNullishOr(before);
  const fetched = activityPageSize + 1;

  const sent = yield* db
    .select({
      row: getTableColumns(transfers),
      key: timeKey(transfers.createdAt),
    })
    .from(transfers)
    .where(
      and(
        eq(transfers.network, network),
        eq(transfers.testnetEpoch, epoch),
        eq(transfers.sender, address),
        ne(transfers.status, "proposed"),
        olderThan(transfers.createdAt, transfers.id, cursor),
      ),
    )
    .orderBy(desc(transfers.createdAt), desc(transfers.id))
    .limit(fetched);

  const received = yield* db
    .select({
      row: getTableColumns(transfers),
      key: timeKey(transfers.createdAt),
      username: usernames.username,
    })
    .from(transfers)
    .innerJoin(usernames, eq(usernames.address, transfers.sender))
    .where(
      and(
        eq(transfers.network, network),
        eq(transfers.testnetEpoch, epoch),
        eq(transfers.recipient, address),
        ne(transfers.sender, address),
        eq(transfers.status, "settled"),
        olderThan(transfers.createdAt, transfers.id, cursor),
      ),
    )
    .orderBy(desc(transfers.createdAt), desc(transfers.id))
    .limit(fetched);

  const action = sql`${assetOrders.order}::jsonb -> 'action'`;

  const claims = yield* db
    .select({
      id: assetOrders.id,
      key: timeKey(assetOrders.concludedAt),
      concludedAt: assetOrders.concludedAt,
      transferOrder: transfers.order,
      sender: transfers.sender,
      username: usernames.username,
    })
    .from(assetOrders)
    .innerJoin(
      transfers,
      and(
        eq(transfers.balanceId, assetOrders.balanceId),
        eq(transfers.network, assetOrders.network),
        eq(transfers.testnetEpoch, assetOrders.testnetEpoch),
        eq(transfers.claimableKind, "paymentLink"),
        eq(transfers.status, "settled"),
      ),
    )
    .innerJoin(usernames, eq(usernames.address, transfers.sender))
    .where(
      and(
        eq(assetOrders.network, network),
        eq(assetOrders.testnetEpoch, epoch),
        eq(assetOrders.status, "settled"),
        isNotNull(assetOrders.concludedAt),
        or(
          and(
            sql`${action} ->> '_tag' = 'ReceiveLink'`,
            eq(assetOrders.wallet, address),
          ),
          and(
            sql`${action} ->> '_tag' = 'ReceiveLinkExternal'`,
            or(
              sql`${action} ->> 'destination' = ${address}`,
              ...destinationPrefixes.map(
                (prefix) =>
                  sql`starts_with(${action} ->> 'destination', ${prefix})`,
              ),
            ),
          ),
        ),
        olderThan(assetOrders.concludedAt, assetOrders.id, cursor),
      ),
    )
    .orderBy(desc(assetOrders.concludedAt), desc(assetOrders.id))
    .limit(fetched);

  const deposited = yield* db
    .select({
      row: getTableColumns(deposits),
      key: timeKey(deposits.closedAt),
    })
    .from(deposits)
    .where(
      and(
        eq(deposits.network, network),
        eq(deposits.testnetEpoch, epoch),
        eq(deposits.wallet, address),
        olderThan(deposits.closedAt, deposits.id, cursor),
      ),
    )
    .orderBy(desc(deposits.closedAt), desc(deposits.id))
    .limit(fetched);

  const candidates = yield* Effect.try({
    try: (): ReadonlyArray<Candidate> => [
      ...sent.map((entry) =>
        Candidate.Sent({
          cursor: cursorOf(entry.key, entry.row.id),
          row: entry.row,
        }),
      ),
      ...received.map((entry) =>
        Candidate.Received({
          cursor: cursorOf(entry.key, entry.row.id),
          row: entry.row,
          username: entry.username,
        }),
      ),
      ...claims.flatMap((entry) =>
        entry.concludedAt === null
          ? []
          : [
              Candidate.LinkClaim({
                cursor: cursorOf(entry.key, entry.id),
                id: entry.id,
                concludedAt: entry.concludedAt,
                transferOrder: entry.transferOrder,
                sender: entry.sender,
                username: entry.username,
              }),
            ],
      ),
      ...deposited.map((entry) =>
        Candidate.Deposited({
          cursor: cursorOf(entry.key, entry.row.id),
          row: entry.row,
        }),
      ),
    ],
    catch: (cause) => new StoreFailure({ cause }),
  });

  const ordered = [...candidates].sort(newestFirst);
  const page = ordered.slice(0, activityPageSize);

  const closedIds = page.flatMap((candidate) =>
    Candidate.$match(candidate, {
      Sent: ({ row }) => (isClosed(row) ? [row.balanceId] : []),
      Received: ({ row }) => (isClosed(row) ? [row.balanceId] : []),
      LinkClaim: () => [],
      Deposited: () => [],
    }),
  );

  const closing =
    closedIds.length === 0
      ? []
      : yield* db
          .select({
            unclaimedFunds: assetOrders.balanceId,
            order: assetOrders.order,
          })
          .from(assetOrders)
          .where(
            and(
              eq(assetOrders.network, network),
              eq(assetOrders.testnetEpoch, epoch),
              eq(assetOrders.status, "settled"),
              inArray(assetOrders.balanceId, closedIds),
            ),
          )
          .orderBy(desc(assetOrders.concludedAt));

  const closers = yield* Effect.try({
    try: (): Closers => {
      const byUnclaimedFunds = new Map<
        string,
        Schema.Schema.Type<typeof StoredOrderJson>
      >();

      for (const entry of closing)
        if (
          entry.unclaimedFunds !== null &&
          !byUnclaimedFunds.has(entry.unclaimedFunds)
        )
          byUnclaimedFunds.set(
            entry.unclaimedFunds,
            Schema.decodeSync(StoredOrderJson)(entry.order),
          );

      return byUnclaimedFunds;
    },
    catch: (cause) => new StoreFailure({ cause }),
  });

  const claimers = [...closers.values()].flatMap((order) =>
    order instanceof AssetOrder ? [order.wallet] : [],
  );

  const named =
    claimers.length === 0
      ? []
      : yield* db
          .select({ address: usernames.address, username: usernames.username })
          .from(usernames)
          .where(inArray(usernames.address, claimers));

  const profiles = yield* Effect.try({
    try: (): Profiles =>
      new Map(
        named.map((entry) => [
          entry.address,
          new Profile({
            address: Schema.decodeSync(AccountAddress)(entry.address),
            username: Schema.decodeSync(Username)(entry.username),
          }),
        ]),
      ),
    catch: (cause) => new StoreFailure({ cause }),
  });

  const entries = yield* Effect.forEach(
    page,
    (candidate): Effect.Effect<ActivityEntry, StoreFailure> =>
      Candidate.$match(candidate, {
        Sent: (sentCandidate) => sentEntry(sentCandidate, closers, profiles),
        Received: (receivedCandidate) =>
          receivedEntry(receivedCandidate, closers),
        LinkClaim: linkClaimEntry,
        Deposited: ({ row }) => depositEntry(row),
      }),
  );

  return new ActivityPage({
    entries,
    next: ordered.length > activityPageSize ? page.at(-1)?.cursor : undefined,
  });
});
