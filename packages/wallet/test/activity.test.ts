import { expect, layer } from "@effect/vitest";
import { Database } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { ExternalRecipient, NotOpened, Profile } from "../src/contract";
import { wallets } from "../src/server/tables.server";
import { Wallet } from "../src/server/Wallet.server";
import { assertTagged } from "./tagged";
import {
  activityOf,
  addressOf,
  claimBalance,
  claimExternally,
  entryFor,
  fundHolder,
  fundLink,
  fundLinkFrom,
  fundedWallet,
  linkAmount,
  payUsername,
  payWithoutTrustline,
  receiveInto,
  useDisposableDatabase,
  username,
  walletTestLayer,
  world,
} from "./wallet-harness";
import { randomKey, randomAddress } from "./test-keys";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "lists a payment once for its sender and once for its recipient and never another wallet's activity, without reading the chain",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const alice = yield* fundedWallet("alice");
          const bruno = yield* fundedWallet("bruno");
          const carla = yield* fundedWallet("carla");
          const diana = yield* fundedWallet("diana");

          yield* fundedWallet("diego");

          const { order } = yield* payUsername(alice, "bruno");

          yield* payUsername(carla, "diego");
          yield* receiveInto(wallet, diana, yield* fundLink("strangerfunder"));

          world.ledgerDown = true;
          world.claimablesDown = true;

          const sent = yield* activityOf(wallet, addressOf(alice));
          const received = yield* activityOf(wallet, addressOf(bruno));

          expect(sent.entries.map((entry) => entry._tag)).toEqual([
            "SentActivity",
          ]);
          expect(sent.entries.map((entry) => entry.id)).toEqual([order.id]);
          expect(received.entries.map((entry) => entry._tag)).toEqual([
            "ReceivedActivity",
          ]);
          expect(received.entries.map((entry) => entry.id)).toEqual([order.id]);

          const sentEntry = entryFor(sent, order.id);

          assertTagged(sentEntry, "SentActivity");
          assertTagged(sentEntry.receipt, "Settled");
          expect(sentEntry.receipt.recipient).toEqual(
            new Profile({
              username: username("bruno"),
              address: addressOf(bruno),
            }),
          );

          const receivedEntry = entryFor(received, order.id);

          assertTagged(receivedEntry, "ReceivedActivity");
          expect(receivedEntry.from).toEqual(
            new Profile({
              username: username("alice"),
              address: addressOf(alice),
            }),
          );
        }),
    );

    it.effect(
      "ends each payment link as claimed into a wallet, claimed to an address, recovered or still open, and lists the claim for the wallet that took it",
      () =>
        Effect.gen(function* () {
          const sender = yield* fundedWallet("linkowner");
          const wallet = yield* Wallet;

          const intoWallet = yield* fundLinkFrom(wallet, sender);
          const toAddress = yield* fundLinkFrom(wallet, sender);
          const recovered = yield* fundLinkFrom(wallet, sender);
          const open = yield* fundLinkFrom(wallet, sender);
          const claimer = yield* fundedWallet("linkclaimer");
          const external = randomKey();

          fundHolder(external);

          const claim = yield* receiveInto(wallet, claimer, intoWallet);

          yield* claimExternally(wallet, toAddress, addressOf(external));
          yield* claimBalance(wallet, sender, recovered.unclaimedFunds);

          const listed = yield* activityOf(wallet, addressOf(sender));

          expect(listed.entries).toHaveLength(4);

          const receiptOf = (id: string) => {
            const entry = entryFor(listed, id);

            assertTagged(entry, "SentActivity");

            return entry.receipt;
          };

          const claimedInto = receiptOf(intoWallet.transferId);

          assertTagged(claimedInto, "Claimed");
          expect(claimedInto.by).toEqual(
            new Profile({
              username: username("linkclaimer"),
              address: addressOf(claimer),
            }),
          );

          const claimedTo = receiptOf(toAddress.transferId);

          assertTagged(claimedTo, "Claimed");
          expect(claimedTo.by).toEqual(
            new ExternalRecipient({ address: addressOf(external) }),
          );
          assertTagged(receiptOf(recovered.transferId), "Refunded");
          assertTagged(receiptOf(open.transferId), "Reserved");

          const claimed = yield* activityOf(wallet, addressOf(claimer));
          const claimEntry = entryFor(claimed, claim.id);

          assertTagged(claimEntry, "ClaimedLinkActivity");
          expect(claimed.entries.map((entry) => entry._tag)).toEqual([
            "ClaimedLinkActivity",
          ]);
          expect(claimEntry.from.username).toBe(username("linkowner"));
          expect(claimEntry.amount).toBe(linkAmount);
        }),
    );

    it.effect(
      "follows a payment that needs acceptance from waiting to received for its recipient and to returned for a payment its sender took back",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const sender = yield* fundedWallet("acceptsender");
          const recipient = yield* fundedWallet("acceptrecipient");

          const accepted = yield* payWithoutTrustline(
            sender,
            "acceptrecipient",
          );

          const waiting = yield* activityOf(wallet, addressOf(recipient));

          assertTagged(
            entryFor(waiting, accepted.order.id),
            "AwaitingAcceptanceActivity",
          );

          const reserved = entryFor(
            yield* activityOf(wallet, addressOf(sender)),
            accepted.order.id,
          );

          assertTagged(reserved, "SentActivity");
          assertTagged(reserved.receipt, "Reserved");

          yield* claimBalance(wallet, recipient, accepted.unclaimedFunds);

          const taken = yield* payWithoutTrustline(sender, "acceptrecipient");

          yield* claimBalance(wallet, sender, taken.unclaimedFunds);

          const asRecipient = yield* activityOf(wallet, addressOf(recipient));
          const asSender = yield* activityOf(wallet, addressOf(sender));

          const acceptedEntry = entryFor(asRecipient, accepted.order.id);

          assertTagged(acceptedEntry, "ReceivedActivity");
          expect(acceptedEntry.closedAt).toBeDefined();
          assertTagged(
            entryFor(asRecipient, taken.order.id),
            "TakenBackActivity",
          );

          const acceptedSent = entryFor(asSender, accepted.order.id);

          assertTagged(acceptedSent, "SentActivity");
          assertTagged(acceptedSent.receipt, "Claimed");
          expect(acceptedSent.receipt.by).toEqual(
            new Profile({
              username: username("acceptrecipient"),
              address: addressOf(recipient),
            }),
          );

          const takenSent = entryFor(asSender, taken.order.id);

          assertTagged(takenSent, "SentActivity");
          assertTagged(takenSent.receipt, "Refunded");
        }),
    );

    it.effect(
      "pages through entries that share a millisecond without repeating or skipping one",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const alice = yield* fundedWallet("pager");

          yield* fundedWallet("pagerpeer");
          yield* payUsername(alice, "pagerpeer");

          const copies = yield* Database.use((db) =>
            db.execute(sql`
              insert into transfers (id, sender, recipient, destination, "order", "resolvedRecipient", amount, network, "testnetEpoch", status, envelope, hash, "expiresAt", "concludedAt", "createdAt")
              select copy.id, t.sender, t.recipient, t.destination, replace(t."order", t.id::text, copy.id::text), t."resolvedRecipient", t.amount, t.network, t."testnetEpoch", t.status, t.envelope, t.hash, t."expiresAt", t."concludedAt", t."createdAt" + copy.step * interval '10 microseconds'
              from transfers t
              cross join lateral (select gen_random_uuid() as id, (series + 1) / 2 as step from generate_series(1, 21) as series) copy
              returning id, to_char("createdAt" at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') as at
            `),
          );

          const expected = [...copies.rows]
            .map((copy) => ({
              id: String(copy.id),
              key: `${copy.at}_${copy.id}`,
            }))
            .sort((left, right) =>
              left.key < right.key ? 1 : left.key > right.key ? -1 : 0,
            )
            .map((copy) => copy.id);

          const first = yield* activityOf(wallet, addressOf(alice));

          expect(first.entries).toHaveLength(20);
          expect(first.next).toBeDefined();

          const second = yield* wallet.activity(addressOf(alice), first.next);

          assertTagged(second, "ActivityPage");
          expect(second.next).toBeUndefined();
          expect(
            [...first.entries, ...second.entries]
              .slice(0, 21)
              .map((entry) => entry.id),
          ).toEqual(expected);
          expect(second.entries).toHaveLength(2);
        }),
    );

    it.effect(
      "an unopened wallet has neither a history nor payment links yet",
      () =>
        Effect.gen(function* () {
          const wallet = yield* Wallet;
          const db = yield* Database;
          const address = addressOf(yield* fundedWallet("unopened"));

          yield* db
            .update(wallets)
            .set({ status: "opening" })
            .where(eq(wallets.address, address));

          expect(yield* wallet.activity(address)).toEqual(new NotOpened());
          expect(yield* wallet.paymentLinks(address)).toEqual(new NotOpened());
        }),
    );

    it.effect("answers an unknown address without a page", () =>
      Effect.gen(function* () {
        const wallet = yield* Wallet;

        expect(yield* wallet.activity(randomAddress())).toEqual(
          new NotOpened(),
        );
      }),
    );
  },
);
