import { expect, layer } from "@effect/vitest";
import { Database } from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import {
  type AccountAddress,
  type ActivityEntry,
  DepositActivity,
  ExternalRecipient,
  LedgerUnreachable,
  ServiceFailed,
  UsernameRecipient,
  baseAsset,
} from "../src/contract";
import type { ChainDeposit } from "../src/server/chain-deposits.server";
import { deposits } from "../src/server/tables.server";
import { Wallet } from "../src/server/Wallet.server";
import { assertTagged } from "./tagged";
import { randomAddress } from "./test-keys";
import {
  activityOf,
  addressOf,
  authorizeTransfer,
  entryFor,
  fundLink,
  fundedWallet,
  orderFor,
  useDisposableDatabase,
  username,
  walletTestLayer,
  world,
} from "./wallet-harness";

useDisposableDatabase();

const ingest = Wallet.use((wallet) => wallet.ingestDeposits);

const depositInto = (
  wallet: AccountAddress,
  overrides: Partial<ChainDeposit> = {},
) => {
  const deposit: ChainDeposit = {
    eventId: crypto.randomUUID(),
    from: randomAddress(),
    amount: 1_000_000n,
    hash: crypto.randomUUID(),
    ledger: 3_000_000_000,
    closedAt: DateTime.nowUnsafe(),
    ...overrides,
  };

  world.deposits.set(wallet, [...(world.deposits.get(wallet) ?? []), deposit]);

  return deposit;
};

const storedAmounts = (address: AccountAddress) =>
  Database.use((db) =>
    db
      .select({ amount: deposits.amount })
      .from(deposits)
      .where(eq(deposits.wallet, address))
      .orderBy(asc(deposits.amount)),
  ).pipe(Effect.map((rows) => rows.map((row) => row.amount)));

const depositEntries = (entries: ReadonlyArray<ActivityEntry>) =>
  entries.flatMap((entry) => (entry instanceof DepositActivity ? [entry] : []));

const listedDeposits = Effect.fn(function* (address: AccountAddress) {
  const wallet = yield* Wallet;

  return depositEntries((yield* activityOf(wallet, address)).entries);
});

const makeStale = Database.use((db) =>
  db.execute(
    sql`update deposit_cursors set "scannedAt" = now() - interval '1 hour'`,
  ),
);

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "lists a deposit from outside once however often it is ingested and never a payment made through Orchid",
      () =>
        Effect.gen(function* () {
          const alice = yield* fundedWallet("alice");
          const bruno = addressOf(yield* fundedWallet("bruno"));
          const sender = randomAddress();

          const { authorized } = yield* authorizeTransfer(
            alice,
            orderFor(
              alice,
              UsernameRecipient.make({ value: username("bruno") }),
            ),
          );

          depositInto(bruno, { from: sender, amount: 25_000_000n });
          depositInto(bruno, {
            from: addressOf(alice),
            hash: authorized.sealed.hash,
          });

          yield* ingest;
          yield* ingest;

          const [listed, ...rest] = yield* listedDeposits(bruno);

          expect(rest).toEqual([]);
          expect(listed?.from).toEqual(
            new ExternalRecipient({ address: sender }),
          );
          expect(listed?.amount).toBe(25_000_000n);
          expect(listed?.asset).toEqual(baseAsset);
        }),
    );

    it.effect(
      "keeps a wallet's cursor at its last stored page when a later page fails, still ingests other wallets, and stores the rest on the next run",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));
          const bruno = addressOf(yield* fundedWallet("bruno"));

          depositInto(alice, { amount: 1_000_000n });

          const failing = depositInto(alice, { amount: 2_000_000n });

          depositInto(bruno, { amount: 3_000_000n });
          world.unreadableDeposits.add(failing.eventId);

          expect(yield* ingest.pipe(Effect.flip)).toEqual(
            new LedgerUnreachable(),
          );
          expect(yield* storedAmounts(alice)).toEqual([1_000_000n]);
          expect(yield* storedAmounts(bruno)).toEqual([3_000_000n]);

          world.unreadableDeposits.clear();
          depositInto(alice, { amount: 4_000_000n });
          yield* ingest;

          expect(yield* storedAmounts(alice)).toEqual([
            1_000_000n,
            2_000_000n,
            4_000_000n,
          ]);
        }),
    );

    it.effect(
      "catches up a wallet's deposits when its activity is read unless it was scanned within a minute, and still answers when the chain is down",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));

          expect(yield* listedDeposits(alice)).toEqual([]);

          depositInto(alice);
          expect(yield* listedDeposits(alice)).toEqual([]);

          yield* makeStale;
          expect(yield* listedDeposits(alice)).toHaveLength(1);

          yield* makeStale;
          world.ledgerDown = true;
          expect(yield* listedDeposits(alice)).toHaveLength(1);
        }),
    );

    it.effect(
      "a scheduled run whose deposit ingest fails still closes unclaimed funds claimed outside Orchid at the time the chain closed them",
      () =>
        Effect.gen(function* () {
          const { wallet, sender, unclaimedFunds, transferId } =
            yield* fundLink("linkowner");

          const closedAt = DateTime.makeUnsafe("2026-11-20T10:00:00Z");

          world.claimables.delete(unclaimedFunds);
          world.closures.set(unclaimedFunds, closedAt);
          world.unreadableDeposits.add(depositInto(addressOf(sender)).eventId);

          expect(
            yield* Wallet.use((service) => service.scheduled).pipe(Effect.flip),
          ).toEqual(new ServiceFailed());

          const entry = entryFor(
            yield* activityOf(wallet, addressOf(sender)),
            transferId,
          );

          assertTagged(entry, "SentActivity");
          assertTagged(entry.receipt, "Claimed");
          expect(entry.receipt.closedAt).toEqual(closedAt);
        }),
    );
  },
);
