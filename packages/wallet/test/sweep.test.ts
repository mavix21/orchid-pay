import { expect, layer } from "@effect/vitest";
import { Database } from "@workspace/db";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AssetOrder,
  AssetOrderId,
  OpenTrustline,
  type AccountAddress,
} from "../src/contract";
import { AssetOrders } from "../src/server/AssetOrders.server";
import { Rejected } from "../src/server/Chain.server";
import { Wallet } from "../src/server/Wallet.server";
import { sweepBatchSize } from "../src/policy";
import { assertTagged } from "./tagged";
import {
  accountState,
  amount,
  addressOf,
  approveOpening,
  authorizeTransfer,
  claimFor,
  create,
  draftTransfer,
  euro,
  expireAttempt,
  findTransfer,
  findWallet,
  fundedWallet,
  opening,
  sealLostOpening,
  selfOrder,
  settleHash,
  sweep,
  sweepNow,
  useDisposableDatabase,
  walletTestLayer,
  walletWithChain,
  world,
} from "./wallet-harness";
import { randomKey } from "./test-keys";

useDisposableDatabase();

const expire = (table: "transfers" | "asset_orders", id: string) =>
  Database.use((db) =>
    db.execute(
      sql`update ${sql.identifier(table)} set "expiresAt" = now() - interval '1 hour' where id = ${id}`,
    ),
  );

const assetDraft = Effect.fn(function* (wallet: AccountAddress) {
  const order = new AssetOrder({
    id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
    wallet,
    action: OpenTrustline.make({ asset: euro }),
  });

  assertTagged(
    yield* Wallet.use((w) => w.manage(order, Option.none())),
    "AssetDraft",
  );

  return order;
});

const assetOrderStored = (order: AssetOrder) =>
  AssetOrders.use((orders) => orders.find(order.id)).pipe(
    Effect.map(Option.isSome),
  );

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect("the sweep never closes an empty open wallet", () =>
      Effect.gen(function* () {
        const claim = yield* create(randomKey(), "maria");
        const initial = world.submitted.length;

        world.accounts.set(
          claim.address,
          accountState({ balance: Option.some(amount("0")) }),
        );
        yield* sweep;
        expect(world.submitted).toHaveLength(initial);
        expect(
          (yield* findWallet(claim.address)).pipe(Option.map((r) => r.status)),
        ).toEqual(Option.some("active"));
      }),
    );

    it.effect(
      "the sweep leaves a record stuck for under five minutes to the queue and picks it up once older",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const order = selfOrder(key);
          const { authorized } = yield* authorizeTransfer(key, order);

          settleHash(authorized.sealed.hash);
          yield* sweepNow;
          assertTagged(
            Option.getOrThrow(yield* findTransfer(order.id)),
            "Authorized",
          );

          yield* sweep;
          assertTagged(
            Option.getOrThrow(yield* findTransfer(order.id)),
            "Concluded",
          );
        }),
    );

    it.effect(
      "one sweep run drains more stuck records than a batch and tries an unresolved one once",
      () =>
        Effect.gen(function* () {
          const names = Array.from(
            { length: sweepBatchSize + 2 },
            (_, index) => `drain${"abcdefgh"[index]}`,
          );

          const stuck = yield* Effect.forEach(names, (name) =>
            Effect.gen(function* () {
              const key = yield* fundedWallet(name);
              const order = selfOrder(key);

              return {
                order,
                authorized: (yield* authorizeTransfer(key, order)).authorized,
              };
            }),
          );

          const [unresolved, ...decided] = stuck;

          if (!unresolved) throw new Error("Expected stuck records");

          for (const { authorized } of decided)
            settleHash(authorized.sealed.hash);

          const submissionsOf = (hash: string) =>
            world.submitted.filter((sealed) => sealed.hash === hash).length;

          const before = submissionsOf(unresolved.authorized.sealed.hash);

          yield* sweep;

          for (const { order } of decided)
            assertTagged(
              Option.getOrThrow(yield* findTransfer(order.id)),
              "Concluded",
            );

          assertTagged(
            Option.getOrThrow(yield* findTransfer(unresolved.order.id)),
            "Authorized",
          );
          expect(submissionsOf(unresolved.authorized.sealed.hash)).toBe(
            before + 1,
          );
        }),
    );

    it.effect(
      "one sweep run settles more stuck openings than a batch, on any testnet epoch, and tries an unresolved one once",
      () =>
        Effect.gen(function* () {
          const names = Array.from(
            { length: sweepBatchSize + 2 },
            (_, index) => `stuck${"abcdefgh"[index]}`,
          );

          const stuck = yield* Effect.forEach(names, (name) =>
            Effect.gen(function* () {
              const key = randomKey();
              const claim = claimFor(key, name);
              const hash = yield* sealLostOpening(key, claim);

              yield* expireAttempt(claim.address);

              return { address: claim.address, hash };
            }),
          );

          const [unresolved, recovered, ...rejected] = stuck;

          if (!unresolved || !recovered)
            throw new Error("Expected stuck openings");

          yield* Database.use((db) =>
            db.execute(
              sql`update wallets set status = 'recovered', "testnetEpoch" = 'an-earlier-epoch' where address = ${recovered.address}`,
            ),
          );
          world.accounts.set(recovered.address, accountState());

          for (const { hash } of rejected)
            world.evidence.set(hash, new Rejected({ code: "txFailed" }));

          yield* sweepNow.pipe(
            Effect.provide(
              walletWithChain(() => ({
                pastOpeningWindow: () => Effect.succeed(false),
              })),
            ),
          );

          expect(
            Option.getOrThrow(yield* findWallet(recovered.address)),
          ).toMatchObject({ status: "active", attemptHash: null });

          for (const { address } of rejected)
            expect(Option.getOrThrow(yield* findWallet(address))).toMatchObject(
              { status: "opening", attemptHash: null },
            );

          expect(
            Option.getOrThrow(yield* findWallet(unresolved.address))
              .attemptHash,
          ).toBe(unresolved.hash);
          expect(world.submitted.map((sealed) => sealed.hash)).toEqual([
            unresolved.hash,
          ]);
        }),
    );

    it.effect(
      "the sweep prunes expired drafts and keeps live drafts and signed work",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const expiredTransfer = selfOrder(key);
          const liveTransfer = selfOrder(key);
          const signedTransfer = selfOrder(key);

          const expiredAsset = yield* assetDraft(addressOf(key));
          const liveAsset = yield* assetDraft(addressOf(key));

          yield* draftTransfer(expiredTransfer);
          yield* draftTransfer(liveTransfer);
          yield* authorizeTransfer(key, signedTransfer, { failSubmit: true });

          yield* expire("transfers", expiredTransfer.id);
          yield* expire("transfers", signedTransfer.id);
          yield* expire("asset_orders", expiredAsset.id);
          yield* sweepNow;

          expect(Option.isSome(yield* findTransfer(expiredTransfer.id))).toBe(
            false,
          );
          expect(Option.isSome(yield* findTransfer(liveTransfer.id))).toBe(
            true,
          );
          expect(Option.isSome(yield* findTransfer(signedTransfer.id))).toBe(
            true,
          );
          expect(yield* assetOrderStored(expiredAsset)).toBe(false);
          expect(yield* assetOrderStored(liveAsset)).toBe(true);
        }),
    );

    it.effect(
      "the sweep prunes expired unbound openings that nothing references",
      () =>
        Effect.gen(function* () {
          const abandoned = claimFor(randomKey(), "abandoned");
          const waiting = claimFor(randomKey(), "waiting");
          const attempting = claimFor(randomKey(), "attempting");
          const sealedKey = randomKey();
          const sealed = claimFor(sealedKey, "sealed");
          const funded = yield* fundedWallet("bound");

          for (const claim of [abandoned, waiting, attempting])
            assertTagged(yield* opening(claim), "OpeningDraft");

          const sealedDraft = yield* opening(sealed);

          assertTagged(sealedDraft, "OpeningDraft");
          assertTagged(
            yield* opening(sealed, approveOpening(sealedKey, sealedDraft)),
            "OpeningPending",
          );

          const draftOnWaiting = crypto.randomUUID();

          yield* Database.use((db) =>
            db.execute(
              sql`insert into asset_orders (id, wallet, "order", network, "testnetEpoch", status, envelope, "expiresAt") select ${draftOnWaiting}, address, '{}', network, "testnetEpoch", 'proposed', 'envelope', now() + interval '1 hour' from wallets where address = ${waiting.address}`,
            ),
          );

          for (const address of [
            abandoned.address,
            waiting.address,
            sealed.address,
            addressOf(funded),
          ])
            yield* expireAttempt(address);

          yield* sweepNow;

          expect(Option.isSome(yield* findWallet(abandoned.address))).toBe(
            false,
          );
          expect(Option.isSome(yield* findWallet(waiting.address))).toBe(true);
          expect(Option.isSome(yield* findWallet(sealed.address))).toBe(true);
          expect(Option.isSome(yield* findWallet(attempting.address))).toBe(
            true,
          );
          expect(Option.isSome(yield* findWallet(addressOf(funded)))).toBe(
            true,
          );

          yield* expire("asset_orders", draftOnWaiting);
          yield* sweepNow;

          expect(Option.isSome(yield* findWallet(waiting.address))).toBe(false);
        }),
    );
  },
);
