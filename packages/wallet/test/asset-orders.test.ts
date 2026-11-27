import { expect, layer } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { CloseTrustline, OpenTrustline } from "../src/contract";
import { AssetOrders } from "../src/server/AssetOrders.server";
import { Sealed } from "../src/server/Chain.server";
import { Directory } from "../src/server/Directory.server";
import { WalletInactive } from "../src/server/slot.server";
import { ReconcileAssetOrder } from "../src/server/work-queue.server";
import { assertTagged } from "./tagged";
import {
  addressOf,
  approve,
  attend,
  authorizeTransfer,
  draftTransfer,
  euro,
  euroLine,
  fundedWallet,
  holdingsFor,
  selfOrder,
  send,
  settleHash,
  useDisposableDatabase,
  walletTestLayer,
  world,
  assetOrder,
  manage,
} from "./wallet-harness";
import { type TestKey } from "./test-keys";

useDisposableDatabase();

const holdTrustline = Effect.fn(function* (key: TestKey) {
  const opening = assetOrder(key, OpenTrustline.make({ asset: euro }));
  const draft = yield* manage(opening);

  assertTagged(draft, "AssetDraft");
  world.failSubmit = true;
  assertTagged(
    yield* manage(opening, approve(draft.request, key)),
    "AssetPending",
  );
  world.failSubmit = false;

  const held = Option.getOrThrow(
    yield* AssetOrders.use((orders) => orders.find(opening.id)),
  );

  assertTagged(held, "AssetAuthorized");

  return { opening, hash: held.sealed.hash };
});

const heldTrustline = Effect.gen(function* () {
  const key = yield* fundedWallet("assetowner");

  return { key, ...(yield* holdTrustline(key)) };
});

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "a queue message resubmits a lost asset order submission and concludes it",
      () =>
        Effect.gen(function* () {
          const { opening, hash } = yield* heldTrustline;
          const message = new ReconcileAssetOrder({ id: opening.id });

          expect(world.queued).toContainEqual(message);
          assertTagged(yield* attend(message), "WorkRetry");
          expect(world.submitted.at(-1)?.hash).toBe(hash);

          settleHash(hash);
          assertTagged(yield* attend(message, 2), "WorkFinished");
          assertTagged(yield* manage(opening), "AssetSettled");
        }),
    );

    it.effect(
      "a stuck asset order is concluded by the next manage instead of returning AssetBusy",
      () =>
        Effect.gen(function* () {
          const { key, hash } = yield* heldTrustline;

          settleHash(hash);
          assertTagged(
            yield* manage(assetOrder(key, OpenTrustline.make({ asset: euro }))),
            "AssetDraft",
          );
        }),
    );

    it.effect(
      "a stuck asset order is concluded by the next transfer instead of returning AssetBusy",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet("assetsender");
          const order = selfOrder(key);
          const draft = yield* draftTransfer(order);

          const held = yield* holdTrustline(key);

          expect((yield* send(order, approve(draft.request, key)))._tag).toBe(
            "AssetBusy",
          );

          settleHash(held.hash);
          assertTagged(
            yield* send(order, approve(draft.request, key)),
            "Pending",
          );
        }),
    );

    it.effect(
      "a held transfer is concluded by manage instead of returning SenderBusy",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet("assetowner");

          const { authorized } = yield* authorizeTransfer(key, selfOrder(key), {
            failSubmit: true,
          });

          assertTagged(
            yield* manage(assetOrder(key, OpenTrustline.make({ asset: euro }))),
            "SenderBusy",
          );

          settleHash(authorized.sealed.hash);
          assertTagged(
            yield* manage(assetOrder(key, OpenTrustline.make({ asset: euro }))),
            "AssetDraft",
          );
        }),
    );

    it.effect(
      "an asset order is not authorized once its wallet stopped being active",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet("assetowner");
          const opening = assetOrder(key, OpenTrustline.make({ asset: euro }));

          assertTagged(yield* manage(opening), "AssetDraft");

          const proposed = Option.getOrThrow(
            yield* AssetOrders.use((orders) => orders.find(opening.id)),
          );

          assertTagged(proposed, "AssetProposed");
          yield* Directory.use((directory) =>
            Effect.flatMap(directory.byAddress(addressOf(key)), (row) =>
              directory.recover(Option.getOrThrow(row)),
            ),
          );
          expect(
            yield* AssetOrders.use((orders) =>
              orders.authorize(
                proposed,
                new Sealed({
                  envelope: "AAAA",
                  hash: "00".repeat(32),
                  expiresAt: DateTime.makeUnsafe(Date.now() + 60_000),
                }),
              ),
            ),
          ).toEqual(new WalletInactive());
          assertTagged(
            Option.getOrThrow(
              yield* AssetOrders.use((orders) => orders.find(opening.id)),
            ),
            "AssetProposed",
          );
        }),
    );

    it.effect(
      "ledger reserve cap and nonzero trustline prevent new sponsored entries and removal",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet("limitowner");
          const addr = addressOf(key);

          world.holdings.set(
            addr,
            holdingsFor(addr, {
              trustlineSlotsUsed: 6,
            }),
          );
          expect(
            (yield* manage(
              assetOrder(key, OpenTrustline.make({ asset: euro })),
            ))._tag,
          ).toBe("TrustlineLimitReached");

          world.holdings.set(
            addr,
            holdingsFor(addr, { lines: [euroLine("1")] }),
          );
          expect(
            (yield* manage(
              assetOrder(key, CloseTrustline.make({ asset: euro })),
            ))._tag,
          ).toBe("TrustlineNotEmpty");
        }),
    );
  },
);
