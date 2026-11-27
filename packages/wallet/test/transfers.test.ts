import {
  type SigningRequest,
  UnclaimedFundsLimitReached,
  Username,
  UsernameRecipient,
} from "../src/contract";
import {
  accountState,
  euro,
  euroLine,
  settleSubmitted,
} from "./wallet-harness";
import { expect, layer } from "@effect/vitest";
import { Database } from "@workspace/db";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import {
  AddressRecipient,
  LedgerUnreachable,
  ExternalRecipient,
  PositiveAmount,
  Profile,
  ServiceFailed,
  TransferOrder,
} from "../src/contract";
import { Chain } from "../src/server/Chain.server";
import { Transfers } from "../src/server/Transfers.server";
import { Directory } from "../src/server/Directory.server";
import { ReconcileTransfer } from "../src/server/work-queue.server";
import { assertTagged } from "./tagged";
import { randomAddress, randomKey } from "./test-keys";
import {
  addressOf,
  approve,
  draftTransfer,
  findTransfer,
  fundHolder,
  holdingsFor,
  orderFor,
  fundedWallet,
  memoryChain,
  overviewOf,
  selfOrder,
  send,
  settleHash,
  ageSignedWork,
  attend,
  authorizeTransfer,
  authorizedTransfers,
  sweep,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./wallet-harness";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "a proposed transfer is not authorized once its wallet stopped being active",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);
          const draft = yield* draftTransfer(order);

          yield* Directory.use((directory) =>
            Effect.flatMap(directory.byAddress(addressOf(key)), (row) =>
              directory.recover(Option.getOrThrow(row)),
            ),
          );
          expect((yield* send(order, approve(draft.request, key)))._tag).toBe(
            "NotOpened",
          );
          assertTagged(
            Option.getOrThrow(yield* findTransfer(order.id)),
            "Proposed",
          );
        }),
    );

    it.effect(
      "a signed transfer survives failed submit and sweep finishes without the device",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);
          const draft = yield* draftTransfer(order);

          expect(draft.recipient).toBeInstanceOf(Profile);
          expect(yield* send(order)).toEqual(draft);

          world.failSubmit = true;
          world.queueDown = true;
          world.queued.length = 0;
          expect((yield* send(order, approve(draft.request, key)))._tag).toBe(
            "Pending",
          );

          const stored = Option.getOrThrow(yield* findTransfer(order.id));

          assertTagged(stored, "Authorized");
          expect(world.queued).toEqual([]);
          world.failSubmit = false;
          yield* sweep;
          expect(world.submitted.at(-1)?.hash).toBe(stored.sealed.hash);

          settleHash(stored.sealed.hash);
          yield* sweep;
          expect((yield* send(order))._tag).toBe("Settled");
        }),
    );

    it.effect(
      "a queue message resubmits a lost transfer submission and concludes it before the transaction expires",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);

          world.queued.length = 0;

          const { authorized } = yield* authorizeTransfer(key, order, {
            failSubmit: true,
          });

          const message = new ReconcileTransfer({ id: order.id });
          const submissions = world.submitted.length;

          expect(world.queued).toEqual([message]);
          assertTagged(yield* attend(message), "WorkRetry");
          expect(world.submitted).toHaveLength(submissions + 1);
          expect(world.submitted.at(-1)?.hash).toBe(authorized.sealed.hash);

          settleHash(authorized.sealed.hash);
          assertTagged(yield* attend(message, 2), "WorkFinished");
          assertTagged(
            Option.getOrThrow(yield* findTransfer(order.id)),
            "Concluded",
          );
        }),
    );

    it.effect(
      "a queue message stops retrying an undecided transfer once the transaction is long expired",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);

          yield* authorizeTransfer(key, order);
          assertTagged(
            yield* attend(new ReconcileTransfer({ id: order.id })),
            "WorkRetry",
          );

          yield* ageSignedWork;
          assertTagged(
            yield* attend(new ReconcileTransfer({ id: order.id })),
            "WorkFinished",
          );
          assertTagged(
            Option.getOrThrow(yield* findTransfer(order.id)),
            "Authorized",
          );
        }),
    );

    it.effect(
      "concurrent approvals allow only one signed transfer per sender",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const orders = [selfOrder(key), selfOrder(key)];

          const drafts = yield* Effect.all(
            orders.map((o) => draftTransfer(o)),
            { concurrency: "unbounded" },
          );

          const results = yield* Effect.all(
            orders.map((order, i) => {
              const draft = drafts[i];

              if (!draft) throw new Error("Expected draft");

              return send(order, approve(draft.request, key));
            }),
            { concurrency: "unbounded" },
          );

          expect(results.filter(Predicate.isTagged("Pending"))).toHaveLength(1);
          expect(results.filter(Predicate.isTagged("SenderBusy"))).toHaveLength(
            1,
          );
          expect(yield* authorizedTransfers).toHaveLength(1);
        }),
    );

    it.effect(
      "same id concurrent approvals keep one immutable sealed envelope",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);
          const draft = yield* draftTransfer(order);
          const before = world.submitted.length;

          const results = yield* Effect.all(
            [
              send(order, approve(draft.request, key)),
              send(order, approve(draft.request, key)),
            ],
            { concurrency: "unbounded" },
          );

          expect(results.map((r) => r._tag)).toEqual(["Pending", "Pending"]);
          const inFlight = yield* authorizedTransfers;

          expect(inFlight).toHaveLength(1);
          const storedEnvelope = inFlight[0]?.envelope;
          const submitted = world.submitted.slice(before);

          expect(new Set(submitted.map((s) => s.envelope))).toEqual(
            new Set([storedEnvelope]),
          );
        }),
    );

    it.effect("database failure during authorization submits nothing", () =>
      Effect.gen(function* () {
        const key = yield* fundedWallet();
        const order = selfOrder(key);
        const draft = yield* draftTransfer(order);
        const initial = world.submitted.length;

        const db = yield* Database;

        yield* db.execute(sql`
          create or replace function fail_transfer_update() returns trigger as $$
          begin
            raise exception 'Database unavailable';
          end;
          $$ language plpgsql
        `);

        yield* db.execute(sql`
          create trigger fail_transfer_update
          before update on transfers
          for each row execute function fail_transfer_update()
        `);

        const failure = yield* send(order, approve(draft.request, key)).pipe(
          Effect.flip,
          Effect.ensuring(
            db
              .execute(
                sql`drop trigger if exists fail_transfer_update on transfers`,
              )
              .pipe(
                Effect.andThen(
                  db.execute(
                    sql`drop function if exists fail_transfer_update()`,
                  ),
                ),
                Effect.orDie,
              ),
          ),
        );

        expect(failure).toEqual(new ServiceFailed());
        expect(world.submitted).toHaveLength(initial);
        expect(Option.getOrThrow(yield* findTransfer(order.id))._tag).toBe(
          "Proposed",
        );
      }),
    );

    it.effect(
      "near-expiry unsigned drafts refresh, while authorized bytes never change",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);

          yield* send(order);
          yield* Database.use((db) =>
            db.execute(
              sql`update transfers set "expiresAt" = now() + interval '5 seconds' where id = ${order.id}`,
            ),
          );

          const refreshed = yield* draftTransfer(order);

          expect(
            DateTime.toEpochMillis(refreshed.request.expiresAt),
          ).toBeGreaterThan(Date.now() + 20_000);
          yield* send(order, approve(refreshed.request, key));

          const authorized = Option.getOrThrow(yield* findTransfer(order.id));

          assertTagged(authorized, "Authorized");
          expect(
            yield* Transfers.use((s) =>
              s.propose(
                order,
                new ExternalRecipient({ address: randomAddress() }),
                refreshed.request,
                Option.none(),
              ),
            ),
          ).toEqual(authorized);

          const changed = new TransferOrder({
            ...order,
            amount: Schema.decodeSync(PositiveAmount)("20000000"),
          });

          expect(yield* send(changed).pipe(Effect.flip)).toEqual(
            new ServiceFailed(),
          );
          expect(Option.getOrThrow(yield* findTransfer(order.id))).toEqual(
            authorized,
          );
        }),
    );

    it.effect(
      "an unsigned newer draft cannot hide the latest authorized or settled receipt",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const first = selfOrder(key);
          const draft = yield* draftTransfer(first);

          yield* send(selfOrder(key));
          yield* send(first, approve(draft.request, key));

          const pendingView = yield* overviewOf(addressOf(key));

          assertTagged(pendingView, "Holding");
          expect(Option.getOrThrow(pendingView.latest)._tag).toBe("Pending");
          expect(Option.getOrThrow(pendingView.latest).id).toBe(first.id);

          const signed = Option.getOrThrow(yield* findTransfer(first.id));

          assertTagged(signed, "Authorized");
          settleHash(signed.sealed.hash);
          expect((yield* send(first))._tag).toBe("Settled");

          const settledView = yield* overviewOf(addressOf(key));

          assertTagged(settledView, "Holding");
          expect(Option.getOrThrow(settledView.latest)._tag).toBe("Settled");
          expect(Option.getOrThrow(settledView.latest).id).toBe(first.id);
        }),
    );

    it.effect(
      "a stale redraft cannot replace a concurrent durable authorization",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);
          const draft = yield* draftTransfer(order);
          const proposed = Option.getOrThrow(yield* findTransfer(order.id));

          assertTagged(proposed, "Proposed");
          yield* send(order, approve(draft.request, key));

          const authorized = Option.getOrThrow(yield* findTransfer(order.id));

          assertTagged(authorized, "Authorized");
          fundHolder(key, { sequence: "1001" });

          const replacement = yield* Chain.use((c) =>
            c.draftPayment(
              order.from,
              addressOf(key),
              order.asset,
              order.amount,
            ),
          ).pipe(Effect.provide(memoryChain));

          const saved = yield* Transfers.use((s) =>
            s.redraft(proposed, replacement, Option.none()),
          );

          assertTagged(saved, "Authorized");
          expect(saved.sealed.envelope).toBe(authorized.sealed.envelope);
        }),
    );

    it.effect(
      "an unreachable ledger refuses an unsigned external step without storing it but leaves an authorized transfer pending",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const destKey = randomKey();

          fundHolder(destKey);

          const order = orderFor(
            key,
            AddressRecipient.make({ value: addressOf(destKey) }),
          );

          world.ledgerDown = true;
          expect(yield* send(order).pipe(Effect.flip)).toEqual(
            new LedgerUnreachable(),
          );
          expect(Option.isNone(yield* findTransfer(order.id))).toBe(true);
          world.ledgerDown = false;

          const draft = yield* draftTransfer(order);

          expect((yield* send(order, approve(draft.request, key)))._tag).toBe(
            "Pending",
          );
          world.ledgerDown = true;
          expect((yield* send(order))._tag).toBe("Pending");
        }),
    );

    it.effect(
      "a claimable drafted before the second slot fills is refused at approval",
      () =>
        Effect.gen(function* () {
          const sender = yield* fundedWallet("quotasender");
          const senderAddr = addressOf(sender);

          yield* fundedWallet("quotarecipient");

          world.holdings.set(
            senderAddr,
            holdingsFor(senderAddr, { lines: [euroLine("50000000")] }),
          );

          const claimable = () =>
            new TransferOrder({
              ...orderFor(
                sender,
                UsernameRecipient.make({
                  value: Schema.decodeSync(Username)("quotarecipient"),
                }),
              ),
              asset: euro,
            });

          const draftAt = Effect.fn(function* (
            order: TransferOrder,
            sequence: string,
          ) {
            world.accounts.set(senderAddr, accountState({ sequence }));

            return yield* send(order);
          });

          const settle = Effect.fn(function* (
            order: TransferOrder,
            draft: SigningRequest,
          ) {
            expect((yield* send(order, approve(draft, sender)))._tag).toBe(
              "Pending",
            );

            yield* settleSubmitted();
            yield* sweep;
          });

          const first = claimable();
          const firstDraft = yield* draftAt(first, "2000");

          assertTagged(firstDraft, "TransferDraft");
          yield* settle(first, firstDraft.request);

          const second = claimable();
          const third = claimable();
          const secondDraft = yield* draftAt(second, "3000");
          const thirdDraft = yield* send(third);

          assertTagged(secondDraft, "TransferDraft");
          assertTagged(thirdDraft, "TransferDraft");
          yield* settle(second, secondDraft.request);

          expect(
            yield* send(third, approve(thirdDraft.request, sender)),
          ).toEqual(new UnclaimedFundsLimitReached({ limit: 2 }));

          world.claimables.clear();
          assertTagged(
            yield* send(third, approve(thirdDraft.request, sender)),
            "Pending",
          );
        }),
    );
  },
);
