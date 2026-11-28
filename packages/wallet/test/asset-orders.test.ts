import { expect, layer } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { ClaimUnclaimedFunds, type UnclaimedFundsId } from "../src/contract";
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
  fundLink,
  fundLinkFrom,
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

const reclaim = (key: TestKey, unclaimedFunds: UnclaimedFundsId) =>
  assetOrder(key, ClaimUnclaimedFunds.make({ unclaimedFunds }));

const holdReclaim = Effect.fn(function* (
  key: TestKey,
  unclaimedFunds: UnclaimedFundsId,
) {
  const reclaimOrder = reclaim(key, unclaimedFunds);
  const draft = yield* manage(reclaimOrder);

  assertTagged(draft, "AssetDraft");
  world.failSubmit = true;
  assertTagged(
    yield* manage(reclaimOrder, approve(draft.request, key)),
    "AssetPending",
  );
  world.failSubmit = false;

  const held = Option.getOrThrow(
    yield* AssetOrders.use((orders) => orders.find(reclaimOrder.id)),
  );

  assertTagged(held, "AssetAuthorized");

  return { reclaimOrder, hash: held.sealed.hash };
});

const heldReclaim = Effect.gen(function* () {
  const { sender, unclaimedFunds } = yield* fundLink("assetowner");
  const held = yield* holdReclaim(sender, unclaimedFunds);

  return { key: sender, ...held };
});

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "a queue message resubmits a lost asset order submission and concludes it",
      () =>
        Effect.gen(function* () {
          const { reclaimOrder, hash } = yield* heldReclaim;
          const message = new ReconcileAssetOrder({ id: reclaimOrder.id });

          expect(world.queued).toContainEqual(message);
          assertTagged(yield* attend(message), "WorkRetry");
          expect(world.submitted.at(-1)?.hash).toBe(hash);

          settleHash(hash);
          assertTagged(yield* attend(message, 2), "WorkFinished");
          assertTagged(yield* manage(reclaimOrder), "AssetSettled");
        }),
    );

    it.effect(
      "a stuck asset order is concluded by the next manage instead of returning AssetBusy",
      () =>
        Effect.gen(function* () {
          const {
            wallet,
            sender: key,
            unclaimedFunds,
          } = yield* fundLink("assetowner");

          const next = yield* fundLinkFrom(wallet, key);
          const { hash } = yield* holdReclaim(key, unclaimedFunds);

          settleHash(hash);
          assertTagged(
            yield* manage(reclaim(key, next.unclaimedFunds)),
            "AssetDraft",
          );
        }),
    );

    it.effect(
      "a stuck asset order is concluded by the next transfer instead of returning AssetBusy",
      () =>
        Effect.gen(function* () {
          const { sender: key, unclaimedFunds } =
            yield* fundLink("assetsender");

          const order = selfOrder(key);
          const draft = yield* draftTransfer(order);

          const held = yield* holdReclaim(key, unclaimedFunds);

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
          const { sender: key, unclaimedFunds } = yield* fundLink("assetowner");

          const { authorized } = yield* authorizeTransfer(key, selfOrder(key), {
            failSubmit: true,
          });

          assertTagged(
            yield* manage(reclaim(key, unclaimedFunds)),
            "SenderBusy",
          );

          settleHash(authorized.sealed.hash);
          assertTagged(
            yield* manage(reclaim(key, unclaimedFunds)),
            "AssetDraft",
          );
        }),
    );

    it.effect(
      "an asset order is not authorized once its wallet stopped being active",
      () =>
        Effect.gen(function* () {
          const { sender: key, unclaimedFunds } = yield* fundLink("assetowner");
          const reclaimOrder = reclaim(key, unclaimedFunds);

          assertTagged(yield* manage(reclaimOrder), "AssetDraft");

          const proposed = Option.getOrThrow(
            yield* AssetOrders.use((orders) => orders.find(reclaimOrder.id)),
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
              yield* AssetOrders.use((orders) => orders.find(reclaimOrder.id)),
            ),
            "AssetProposed",
          );
        }),
    );
  },
);
