import { expect, layer } from "@effect/vitest";
import { Address, Keypair } from "@stellar/stellar-sdk";
import { Database } from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import {
  type AccountAddress,
  type ActivityEntry,
  DepositActivity,
  ExternalRecipient,
  UsernameRecipient,
  baseAsset,
} from "../src/contract";
import { Wallet } from "../src/server/Wallet.server";
import { depositCursors, deposits } from "../src/server/tables.server";
import {
  depositContract,
  epochAt,
  network,
  usdc,
} from "../src/stellar/network";
import { memoryKeyStore, signingKey } from "./device-fixtures";
import {
  claimEvent,
  ledgers,
  mintEvent,
  muxedPaymentEvent,
  paymentEvent,
  unreadableEvent,
} from "./rpc-events";
import { assertTagged } from "./tagged";
import {
  activityOf,
  entryFor,
  payUsername,
  receiveInto,
  username,
  fundLink,
  fundLinkFrom,
  addressOf,
  authorizeTransfer,
  fundedWallet,
  holdingsFor,
  openSender,
  orderFor,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./stellar-harness";

useDisposableDatabase();

const ingest = Wallet.use((wallet) => wallet.ingestDeposits);

const outsider = () => addressOf(Keypair.random());

const depositEntries = (entries: ReadonlyArray<ActivityEntry>) =>
  entries.flatMap((entry) => (entry instanceof DepositActivity ? [entry] : []));

const listedDeposits = Effect.fn(function* (address: AccountAddress) {
  const wallet = yield* Wallet;

  return depositEntries((yield* activityOf(wallet, address)).entries);
});

const storedAmounts = (address: AccountAddress) =>
  Database.use((db) =>
    db
      .select({ amount: deposits.amount })
      .from(deposits)
      .where(eq(deposits.wallet, address))
      .orderBy(asc(deposits.ledger), asc(deposits.eventId)),
  ).pipe(Effect.map((rows) => rows.map((row) => row.amount)));

const cursorRows = Database.use((db) => db.select().from(depositCursors));

const placeCursor = (ledger: number, ageSeconds: number) => {
  const cursor = `${(BigInt(ledger) << 32n).toString().padStart(19, "0")}-0000000000`;
  const closedAt = new Date(Date.now() - ageSeconds * 1000);

  return Database.use((db) =>
    db
      .insert(depositCursors)
      .values({
        network,
        testnetEpoch: epochAt(Date.now()),
        contractId: depositContract,
        cursor,
        ledger,
        closedAt,
      })
      .onConflictDoUpdate({
        target: [
          depositCursors.network,
          depositCursors.testnetEpoch,
          depositCursors.contractId,
        ],
        set: { cursor, ledger, closedAt },
      }),
  );
};

const makeStale = Database.use((db) =>
  db.execute(
    sql`update deposit_cursors set "closedAt" = now() - interval '1 hour'`,
  ),
);

const cursorLedgers = cursorRows.pipe(
  Effect.map((rows) => rows.map((row) => row.ledger)),
);

const lastSubmittedHash = () =>
  Option.getOrThrow(Option.fromNullishOr(world.submitted.at(-1))).hash;

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "lists a payment from outside once however often it is read and keeps it after RPC forgets its ledger",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));
          const sender = outsider();

          paymentEvent(sender, alice, 25_000_000n, { ledger: 150 });
          yield* ingest;
          yield* ingest;

          const [listed] = yield* listedDeposits(alice);

          expect(listed?.from).toEqual(
            new ExternalRecipient({ address: sender }),
          );
          expect(listed?.amount).toBe(25_000_000n);
          expect(listed?.asset).toEqual(baseAsset);

          yield* placeCursor(100, 3600);
          expect(yield* listedDeposits(alice)).toHaveLength(1);

          ledgers.oldestLedger = 190;
          yield* ingest;
          expect(yield* listedDeposits(alice)).toHaveLength(1);
        }),
    );

    it.effect(
      "lists a payment from the issuer as a deposit sent by the issuer",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));

          mintEvent(alice, 5_000_000n);
          yield* ingest;

          const [listed] = yield* listedDeposits(alice);

          expect(listed?.from.address).toBe(usdc.issuer);
        }),
    );

    it.effect(
      "keeps the cursor at the last stored page when a page fails and stores the rest on the next run",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));

          paymentEvent(outsider(), alice, 1_000_000n, { ledger: 150 });
          paymentEvent(outsider(), alice, 2_000_000n, { ledger: 160 });
          ledgers.maxEventsPerResponse = 1;
          ledgers.failingRequest = 2;

          expect(Exit.isFailure(yield* Effect.exit(ingest))).toBe(true);
          expect(yield* storedAmounts(alice)).toEqual([1_000_000n]);
          expect(yield* cursorLedgers).toEqual([150]);

          ledgers.failingRequest = 0;
          yield* ingest;
          expect(yield* storedAmounts(alice)).toEqual([1_000_000n, 2_000_000n]);
        }),
    );

    it.effect(
      "keeps reading after a short page that stopped before the latest ledger",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));

          ledgers.latestLedger = 20_500;
          paymentEvent(outsider(), alice, 1_000_000n, { ledger: 20_400 });
          yield* ingest;

          expect(yield* storedAmounts(alice)).toEqual([1_000_000n]);
        }),
    );

    it.effect(
      "keeps reading after a truncated page that already reached the latest ledger",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));

          paymentEvent(outsider(), alice, 1_000_000n, { transaction: 0 });
          paymentEvent(outsider(), alice, 2_000_000n, { transaction: 1 });
          ledgers.maxEventsPerResponse = 1;
          yield* ingest;

          expect(yield* storedAmounts(alice)).toEqual([1_000_000n, 2_000_000n]);
        }),
    );

    it.effect.each([
      { name: "no cursor was stored", cursorLedger: undefined, oldest: 100 },
      {
        name: "the cursor lies below RPC's ledgers",
        cursorLedger: 120,
        oldest: 150,
      },
      {
        name: "the cursor lies above RPC's ledgers",
        cursorLedger: 9_000,
        oldest: 100,
      },
    ])("starts at the oldest ledger when $name", ({ cursorLedger, oldest }) =>
      Effect.gen(function* () {
        const alice = addressOf(yield* fundedWallet("alice"));

        ledgers.oldestLedger = oldest;

        if (cursorLedger !== undefined) yield* placeCursor(cursorLedger, 3600);

        paymentEvent(outsider(), alice, 1_000_000n, { ledger: oldest });
        yield* ingest;

        expect(yield* storedAmounts(alice)).toEqual([1_000_000n]);
      }),
    );

    it.effect(
      "never lists a payment made through Orchid or a link the wallet claimed, and lists one signed elsewhere with the same key",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const alice = yield* fundedWallet("alice");
          const bruno = addressOf(yield* fundedWallet("bruno"));
          const claimer = yield* fundedWallet("linkclaimer");

          const order = orderFor(
            alice,
            UsernameRecipient.make({ value: username("bruno") }),
          );

          const { authorized } = yield* authorizeTransfer(alice, order);

          paymentEvent(addressOf(alice), bruno, 10_000_000n, {
            hash: authorized.sealed.hash,
          });

          const funded = yield* fundLink("linkowner");

          yield* receiveInto(wallet, claimer, funded);

          const claimHash = lastSubmittedHash();

          claimEvent(
            funded.unclaimedFunds,
            addressOf(funded.link),
            10_000_000n,
            {
              hash: claimHash,
            },
          );
          paymentEvent(
            addressOf(funded.link),
            addressOf(claimer),
            10_000_000n,
            { hash: claimHash },
          );
          yield* ingest;

          expect(yield* storedAmounts(bruno)).toEqual([]);
          expect(yield* storedAmounts(addressOf(claimer))).toEqual([]);

          ledgers.latestLedger = 210;
          paymentEvent(addressOf(alice), bruno, 5_000_000n, { ledger: 205 });
          yield* ingest;

          expect(yield* storedAmounts(bruno)).toEqual([5_000_000n]);
        }),
    );

    it.effect(
      "closes the unclaimed funds of a claim made outside Orchid whoever received it and lists no deposit for the claim",
      () =>
        Effect.gen(function* () {
          const { wallet, sender } = yield* openSender(
            memoryKeyStore(),
            "linkowner",
          );

          const toOutsider = yield* fundLinkFrom(wallet, sender);
          const toWallet = yield* fundLinkFrom(wallet, sender);
          const stillOpen = yield* fundLinkFrom(wallet, sender);
          const claimer = addressOf(yield* fundedWallet("linkclaimer"));
          const recipient = yield* fundedWallet("acceptrecipient");
          const recipientAddress = addressOf(recipient);

          world.holdings.set(
            recipientAddress,
            holdingsFor(recipientAddress, { lines: [] }),
          );

          const { order, settled } = yield* payUsername(
            signingKey(sender.phrase),
            "acceptrecipient",
          );

          const accepted = Option.getOrThrow(
            Option.fromNullishOr(settled.unclaimedFunds),
          );

          claimEvent(toOutsider.unclaimedFunds, outsider(), 10_000_000n);
          claimEvent(toWallet.unclaimedFunds, claimer, 10_000_000n);
          claimEvent(accepted, recipientAddress, order.amount);
          yield* ingest;

          const listed = yield* activityOf(wallet, sender.address);

          for (const { transferId } of [toOutsider, toWallet]) {
            const entry = entryFor(listed, transferId);

            assertTagged(entry, "SentActivity");
            assertTagged(entry.receipt, "Claimed");
            expect(entry.receipt.by).toBeUndefined();
          }

          const acceptedEntry = entryFor(listed, order.id);

          assertTagged(acceptedEntry, "SentActivity");
          assertTagged(acceptedEntry.receipt, "Claimed");

          const openEntry = entryFor(listed, stillOpen.transferId);

          assertTagged(openEntry, "SentActivity");
          assertTagged(openEntry.receipt, "Reserved");
          assertTagged(
            entryFor(yield* activityOf(wallet, recipientAddress), order.id),
            "ReceivedActivity",
          );
          expect(yield* storedAmounts(claimer)).toEqual([]);
          expect(yield* storedAmounts(recipientAddress)).toEqual([]);
        }),
    );

    it.effect(
      "stores a deposit found for this wallet when the cursor is stale and leaves the cursor alone, but not when it is fresh",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));

          yield* ingest;

          const before = yield* cursorRows;

          paymentEvent(outsider(), alice, 4_000_000n);
          expect(yield* listedDeposits(alice)).toEqual([]);

          yield* makeStale;

          const stale = yield* cursorRows;

          expect(yield* listedDeposits(alice)).toHaveLength(1);
          expect(yield* cursorRows).toEqual(stale);
          expect(stale.map((row) => row.cursor)).toEqual(
            before.map((row) => row.cursor),
          );
        }),
    );

    it.effect(
      "stores a recent deposit when no cursor exists and still answers when RPC fails",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));

          paymentEvent(outsider(), alice, 4_000_000n, { ledger: 150 });
          expect(yield* listedDeposits(alice)).toHaveLength(1);
          expect(yield* cursorRows).toEqual([]);

          ledgers.down = true;
          expect(yield* listedDeposits(alice)).toHaveLength(1);
        }),
    );

    it.effect(
      "reads a payment to a muxed destination and skips an unreadable event or a payment from a contract",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));

          unreadableEvent(alice);
          paymentEvent(
            new Address(depositContract).toString(),
            alice,
            9_000_000n,
          );
          muxedPaymentEvent(outsider(), alice, 3_000_000n);
          yield* ingest;

          expect(yield* storedAmounts(alice)).toEqual([3_000_000n]);
        }),
    );

    it.effect(
      "still ingests deposits in a scheduled run whose sweep fails",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));

          yield* fundLink("sweepowner");
          world.claimablesDown = true;
          paymentEvent(outsider(), alice, 6_000_000n);

          const scheduled = yield* Effect.exit(
            Wallet.use((wallet) => wallet.scheduled),
          );

          expect(Exit.isFailure(scheduled)).toBe(true);
          expect(yield* storedAmounts(alice)).toEqual([6_000_000n]);
        }),
    );

    it.effect(
      "still sweeps in a scheduled run whose deposit ingest fails",
      () =>
        Effect.gen(function* () {
          const { wallet, sender, unclaimedFunds, transferId } =
            yield* fundLink("sweepowner");

          world.claimables.delete(unclaimedFunds);
          ledgers.down = true;

          const scheduled = yield* Effect.exit(
            Wallet.use((service) => service.scheduled),
          );

          const entry = entryFor(
            yield* activityOf(wallet, sender.address),
            transferId,
          );

          expect(Exit.isFailure(scheduled)).toBe(true);
          assertTagged(entry, "SentActivity");
          assertTagged(entry.receipt, "Claimed");
        }),
    );

    it.effect(
      "catches up from near the latest ledger when the cursor is too old to resume from",
      () =>
        Effect.gen(function* () {
          const alice = addressOf(yield* fundedWallet("alice"));

          ledgers.latestLedger = 20_500;
          yield* placeCursor(100, 14 * 3600);
          paymentEvent(outsider(), alice, 4_000_000n, { ledger: 20_450 });

          expect(yield* listedDeposits(alice)).toHaveLength(1);
        }),
    );
  },
);
