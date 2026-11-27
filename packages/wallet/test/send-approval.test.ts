import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { address } from "@solana/kit";
import {
  AddressRecipient,
  AssetId,
  ExternalRecipient,
  Holding,
  Offline,
  Profile,
  Settled,
  TransferIntent,
  type UnsignedEnvelope,
  baseAsset,
} from "../src/contract";
import { DraftRejected, makeWalletEffects } from "../src/device/client";
import type { KeyStore } from "../src/device/key-store";
import {
  DeviceWallet,
  nowSeconds,
  transferDraftOf,
  unusedPort,
} from "./device-fixtures";
import {
  approvingDevice,
  installSealedWallet,
  sealedKeyStore,
} from "./sealed-wallet-fixtures";
import {
  actors,
  amount,
  memoryDrafting,
  otherAmount,
  memo,
  otherMemo,
  passkeys,
  payment,
  reviewed,
  sealedDrafting,
  toExchange,
  toPedro,
} from "./send-fixtures";
import { approvalMargin, draftLifetime } from "../src/policy";
import { randomAddress } from "./test-keys";

const deviceWith = (...args: Parameters<typeof memoryDrafting>) => {
  const drafting = memoryDrafting(...args);

  return {
    ...drafting,
    client: makeWalletEffects(drafting.port, drafting.store, passkeys),
  };
};

const sealedWith = Effect.fn(function* (
  ...args: Parameters<typeof sealedDrafting>
) {
  const drafting = yield* sealedDrafting(...args);

  return {
    ...drafting,
    client: makeWalletEffects(
      drafting.port,
      sealedKeyStore,
      passkeys,
      drafting.device,
    ),
  };
});

const otherMint = {
  ...baseAsset,
  id: Schema.decodeSync(AssetId)(randomAddress()),
};

const mismatches: ReadonlyArray<
  readonly [string, TransferIntent, () => UnsignedEnvelope]
> = [
  [
    "a payment to another address",
    new TransferIntent({
      ...toExchange,
      to: AddressRecipient.make({ value: actors.stranger }),
    }),
    () => payment(),
  ],
  [
    "a payment into a token account at the ordered address instead of its USDC account",
    toExchange,
    () =>
      actors.drafts.payment({
        from: actors.sender,
        to: actors.exchange,
        amount,
        memo,
        creditedAccount: address(actors.exchange),
      }),
  ],
  [
    "a payment of another asset",
    new TransferIntent({ ...toExchange, asset: otherMint }),
    () => payment(),
  ],
  [
    "a payment of another amount",
    new TransferIntent({ ...toExchange, amount: otherAmount }),
    () => payment(),
  ],
  [
    "a payment with another memo",
    new TransferIntent({ ...toExchange, memo: otherMemo }),
    () => payment(),
  ],
];

it.live.each(mismatches)("refuses %s", ([, intent, envelope]) =>
  Effect.gen(function* () {
    const { approvals, client } = deviceWith(envelope);

    expect(yield* client.review(intent)).toEqual(new DraftRejected());
    expect(approvals.filter(Option.isSome)).toHaveLength(0);
  }),
);

it.live("reviews a payment to the ordered owner, not its USDC account", () =>
  Effect.gen(function* () {
    const { client } = deviceWith(() => payment());

    expect((yield* reviewed(client, toExchange)).to).toBe(actors.exchange);
  }),
);

it.live(
  "presents no draft that keeps expiring within the approval margin",
  () =>
    Effect.gen(function* () {
      const { approvals, client } = deviceWith(() => payment(), {
        lifetime: approvalMargin - 1,
      });

      expect(yield* client.review(toExchange)).toEqual(new DraftRejected());
      expect(approvals.filter(Option.isSome)).toHaveLength(0);
    }),
);

it.effect(
  "spends the order's single redraft once when overlapping confirmations find its draft expiring",
  () =>
    Effect.gen(function* () {
      const lifetimes = [approvalMargin + 1, approvalMargin - 1];
      let drafted = 0;

      const { client } = yield* sealedWith(() => payment(), {
        lifetime: () => lifetimes[drafted++] ?? draftLifetime,
      });

      const review = yield* reviewed(client, toExchange);

      yield* TestClock.adjust("3 seconds");

      expect(
        yield* Effect.all([client.confirm(review), client.confirm(review)], {
          concurrency: "unbounded",
        }),
      ).toEqual([new DraftRejected(), new DraftRejected()]);
    }),
);

it.live("signs only one draft for an order", () =>
  Effect.gen(function* () {
    const { approvals, client } = yield* sealedWith(() => payment());

    const outcome = yield* client.confirm(yield* reviewed(client, toExchange));

    expect(outcome._tag).toBe("ApprovalOutstanding");
    expect(approvals.filter(Option.isSome)).toHaveLength(1);
  }),
);

it.live(
  "two concurrent reviews for the same intent submit at most one order and keep an unrelated signed order",
  () =>
    Effect.gen(function* () {
      const { auth } = yield* installSealedWallet(actors.wallet);
      const secondObservedEmpty = yield* Latch.make();
      const firstSettled = yield* Latch.make();
      const pedroSubmissions: Array<string> = [];
      let otherOrderId: string | undefined;

      const delayedStore: KeyStore = {
        ...sealedKeyStore,
        readPublic: () =>
          sealedKeyStore
            .readPublic()
            .pipe(Effect.tap(() => secondObservedEmpty.open)),
        updatePublic: (update) =>
          firstSettled.await.pipe(
            Effect.andThen(sealedKeyStore.updatePublic(update)),
          ),
      };

      const port = unusedPort({
        transfer: (order, approval) =>
          Effect.gen(function* () {
            if (Predicate.isTagged(order.to, "Address")) {
              if (Option.isSome(approval)) {
                otherOrderId = order.id;

                return yield* Effect.fail(new Offline());
              }

              const at = nowSeconds();

              return transferDraftOf(
                payment(),
                new ExternalRecipient({ address: actors.exchange }),
                draftLifetime,
                at,
              );
            }

            if (Option.isSome(approval)) {
              pedroSubmissions.push(order.id);

              return new Settled({
                id: order.id,
                to: order.to,
                recipient: actors.pedroProfile,
                asset: order.asset,
                amount: order.amount,
                settledAt: DateTime.makeUnsafe(Date.now()),
              });
            }

            const at = nowSeconds();

            return transferDraftOf(
              actors.payment({ to: actors.pedro, amount }),
              actors.pedroProfile,
              draftLifetime,
              at,
            );
          }),
      });

      const firstClient = makeWalletEffects(
        port,
        sealedKeyStore,
        passkeys,
        approvingDevice(auth),
      );

      const secondClient = makeWalletEffects(port, delayedStore, passkeys);
      const second = yield* Effect.forkChild(secondClient.review(toPedro));

      yield* secondObservedEmpty.await;

      const firstOutcome = yield* firstClient.confirm(
        yield* reviewed(firstClient, toPedro),
      );

      yield* firstClient.confirm(yield* reviewed(firstClient, toExchange));

      yield* firstSettled.open;

      const secondOutcome = yield* Fiber.join(second);
      const stored = Option.getOrThrow(yield* sealedKeyStore.readPublic());

      expect(pedroSubmissions).toHaveLength(1);
      expect(firstOutcome._tag).toBe("Settled");
      expect(secondOutcome._tag).toBe("DraftRejected");
      expect(stored.transfer?.id).toBe(otherOrderId);
    }),
);

it.live(
  "a second tab confirming the same order after it settled submits nothing",
  () =>
    Effect.gen(function* () {
      const submissions: Array<string> = [];
      const { auth } = yield* installSealedWallet(actors.wallet);

      const port = unusedPort({
        transfer: (order, approval) =>
          Effect.sync(() => {
            if (Option.isSome(approval)) {
              submissions.push(order.id);

              return new Settled({
                id: order.id,
                to: order.to,
                recipient: actors.pedroProfile,
                asset: order.asset,
                amount: order.amount,
                settledAt: DateTime.makeUnsafe(Date.now()),
              });
            }

            const at = nowSeconds();

            return transferDraftOf(
              actors.payment({ to: actors.pedro, amount }),
              actors.pedroProfile,
              draftLifetime,
              at,
            );
          }),
      });

      const tab = () =>
        makeWalletEffects(
          port,
          sealedKeyStore,
          passkeys,
          approvingDevice(auth),
        );

      const first = tab();
      const second = tab();
      const firstReview = yield* reviewed(first, toPedro);
      const secondReview = yield* reviewed(second, toPedro);

      expect(secondReview.order.id).toBe(firstReview.order.id);
      expect((yield* first.confirm(firstReview))._tag).toBe("Settled");
      expect((yield* second.confirm(secondReview))._tag).toBe("DraftRejected");
      expect(submissions).toEqual([firstReview.order.id]);
    }),
);

it.live(
  "overview storing the reserve sponsor preserves a concurrent transfer order and approval",
  () =>
    Effect.gen(function* () {
      const { auth } = yield* installSealedWallet(
        new DeviceWallet({ ...actors.wallet, reserveSponsor: undefined }),
      );

      const overviewReading = yield* Latch.make();
      const releaseOverview = yield* Latch.make();

      const port = unusedPort({
        overview: () =>
          overviewReading.open.pipe(
            Effect.andThen(releaseOverview.await),
            Effect.as(
              new Holding({
                profile: new Profile({
                  address: actors.sender,
                  username: actors.wallet.username,
                }),
                reserveSponsor: Option.some(actors.sponsor),
                balances: [],
                unclaimedFunds: [],
                latest: Option.none(),
              }),
            ),
          ),
        transfer: (_order, approval) =>
          Option.isSome(approval)
            ? Effect.fail(new Offline())
            : Effect.sync(() => {
                const at = nowSeconds();

                return transferDraftOf(
                  actors.payment({ to: actors.pedro, amount }),
                  actors.pedroProfile,
                  draftLifetime,
                  at,
                );
              }),
      });

      const client = makeWalletEffects(
        port,
        sealedKeyStore,
        passkeys,
        approvingDevice(auth),
      );

      const loadingOverview = yield* Effect.forkChild(client.overview());

      yield* overviewReading.await;
      expect(yield* client.confirm(yield* reviewed(client, toPedro))).toEqual(
        new Offline(),
      );

      const afterSend = Option.getOrThrow(yield* sealedKeyStore.readPublic());

      yield* releaseOverview.open;
      expect((yield* Fiber.join(loadingOverview))._tag).toBe("Holding");

      const afterOverview = Option.getOrThrow(
        yield* sealedKeyStore.readPublic(),
      );

      expect(afterSend.approvedUntil).toBeDefined();
      expect(afterOverview.reserveSponsor).toBe(actors.sponsor);
      expect(afterOverview.transfer?.id).toBe(afterSend.transfer?.id);
      expect(afterOverview.approvedUntil).toBe(afterSend.approvedUntil);
    }),
);
