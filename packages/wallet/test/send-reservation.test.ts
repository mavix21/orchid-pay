import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { approvalMargin } from "../src/policy";
import {
  ExternalMemoRequired,
  ExternalRecipient,
  Pending,
  RateLimited,
  SessionRequired,
  TransferId,
  TransferIntent,
  TransferOrder,
  type WalletPort,
  baseAsset,
} from "../src/contract";
import {
  PaymentLinkIntent,
  type WalletEffects,
  makeWalletEffects,
} from "../src/device/client";
import { PublicDeviceWallet } from "../src/device/key-store";
import {
  DeviceWallet,
  memoryKeyStore,
  nowSeconds,
  savedWallet,
  transferDraftOf,
  unusedPort,
} from "./device-fixtures";
import { sealedKeyStore } from "./sealed-wallet-fixtures";
import { assertTagged } from "./tagged";
import {
  actors,
  amount,
  memoryDrafting,
  otherAmount,
  passkeys,
  payment,
  reviewed,
  sealedDrafting,
  toExchange,
} from "./send-fixtures";

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

it.live(
  "keeps a signed order whose signature expired while the server reports it pending",
  () =>
    Effect.gen(function* () {
      const signed = new TransferOrder({
        ...toExchange,
        id: Schema.decodeSync(TransferId)(crypto.randomUUID()),
        from: actors.sender,
      });

      const inFlight = new Pending({
        ...signed,
        recipient: new ExternalRecipient({ address: actors.exchange }),
        expiresAt: DateTime.makeUnsafe(Date.now()),
      });

      const { approvals, client, store } = deviceWith(() => payment(), {
        answer: () => Option.some(inFlight),
        initial: new DeviceWallet({
          ...actors.wallet,
          transfer: signed,
          approvedUntil: nowSeconds() - 3600,
        }),
      });

      expect(
        (yield* client.review(
          new TransferIntent({ ...toExchange, amount: otherAmount }),
        ))._tag,
      ).toBe("ApprovalOutstanding");
      expect(approvals).toEqual([Option.none()]);
      expect((yield* savedWallet(store)).transfer?.id).toBe(signed.id);
    }),
);

it.live("releases an expired signed order the server never authorized", () =>
  Effect.gen(function* () {
    const oldOrder = new TransferOrder({
      ...toExchange,
      id: Schema.decodeSync(TransferId)(crypto.randomUUID()),
      from: actors.sender,
    });

    const refusal = new ExternalMemoRequired({
      address: actors.exchange,
      exchange: "Synthetic exchange",
      source: "https://example.com",
    });

    const { client, orderIds, store } = deviceWith(() => payment(), {
      answer: () => Option.some(refusal),
      initial: new DeviceWallet({
        ...actors.wallet,
        transfer: oldOrder,
        approvedUntil: nowSeconds() - 3600,
      }),
    });

    yield* client.review(
      new TransferIntent({ ...toExchange, amount: otherAmount }),
    );
    expect(orderIds).toHaveLength(2);
    expect(orderIds[0]).toBe(oldOrder.id);
    expect(orderIds[1]).not.toBe(oldOrder.id);
    expect((yield* savedWallet(store)).transfer?.id).toBe(orderIds[1]);
  }),
);

it.effect(
  "withdraws the reservation unsigned when the margin lapses during its commit and offers one fresh review",
  () =>
    Effect.gen(function* () {
      const writing = yield* Latch.make();

      const { approvals, client } = yield* sealedWith(() => payment(), {
        lifetime: approvalMargin + 1,
        beforeReservation: writing.open.pipe(
          Effect.andThen(Effect.sleep("1500 millis")),
        ),
      });

      const review = yield* reviewed(client, toExchange);
      const confirming = yield* Effect.forkChild(client.confirm(review));

      yield* writing.await;
      yield* TestClock.adjust("3000 millis");

      const outcome = yield* Fiber.join(confirming);

      assertTagged(outcome, "PaymentReview");
      expect(outcome.redrafted).toBe(true);
      expect(approvals.filter(Option.isSome)).toHaveLength(0);
      expect(
        Option.getOrThrow(yield* sealedKeyStore.readPublic()).approvedUntil,
      ).toBeUndefined();
    }),
);

const sessionCheckedClient = Effect.fn(function* (
  intercept: (drafted: WalletPort["transfer"]) => WalletPort["transfer"],
) {
  const drafting = yield* sealedDrafting(() => payment());

  return makeWalletEffects(
    { ...drafting.port, transfer: intercept(drafting.port.transfer) },
    sealedKeyStore,
    passkeys,
    drafting.device,
  );
});

const confirmingTransfer = (client: WalletEffects) =>
  reviewed(client, toExchange).pipe(Effect.flatMap(client.confirm));

it.live.each([
  { name: "a session", refusal: () => new SessionRequired() },
  { name: "a rate limit", refusal: () => new RateLimited() },
])(
  "$name refusal of the approval-bearing call withdraws the reservation because nothing was released",
  ({ refusal }) =>
    Effect.gen(function* () {
      const client = yield* sessionCheckedClient(
        (drafted) => (order, approval) =>
          Option.isSome(approval)
            ? Effect.fail(refusal())
            : drafted(order, approval),
      );

      assertTagged(yield* confirmingTransfer(client), refusal()._tag);
      expect(
        Option.getOrThrow(yield* sealedKeyStore.readPublic()).approvedUntil,
      ).toBeUndefined();
    }),
);

it.live(
  "a session refusal of a poll after the order went pending keeps the reservation",
  () =>
    Effect.gen(function* () {
      let released = false;

      const client = yield* sessionCheckedClient(
        (drafted) => (order, approval) => {
          if (released) return Effect.fail(new SessionRequired());

          if (Option.isNone(approval)) return drafted(order, approval);

          released = true;

          return Effect.succeed(
            new Pending({
              ...order,
              recipient: new ExternalRecipient({ address: actors.exchange }),
              expiresAt: DateTime.makeUnsafe(Date.now() + 60_000),
            }),
          );
        },
      );

      assertTagged(yield* confirmingTransfer(client), "SessionRequired");
      expect(
        Option.getOrThrow(yield* sealedKeyStore.readPublic()).approvedUntil,
      ).toBeDefined();
    }),
);

const linkIntent = new PaymentLinkIntent({
  asset: baseAsset,
  amount,
  saveOnDevice: false,
});

it.live.each([
  {
    name: "a transfer",
    confirmation: (client: WalletEffects) =>
      reviewed(client, toExchange).pipe(Effect.flatMap(client.confirm)),
  },
  {
    name: "a payment link",
    confirmation: (client: WalletEffects) =>
      client
        .reviewPaymentLink(linkIntent)
        .pipe(
          Effect.flatMap((review) =>
            Predicate.isTagged(review, "PaymentReview")
              ? client.confirmPaymentLink(review)
              : Effect.succeed(review),
          ),
        ),
  },
])(
  "an interrupt arriving while the reservation for $name commits releases nothing and withdraws it",
  ({ confirmation }) =>
    Effect.gen(function* () {
      const committing = yield* Latch.make();
      const proceed = yield* Latch.make();

      const { approvals, client } = yield* sealedWith(
        (_, order) =>
          Predicate.isTagged(order.to, "PaymentLink")
            ? actors.paymentLink({ to: order.to.value, amount })
            : payment(),
        {
          beforeReservation: committing.open.pipe(
            Effect.andThen(proceed.await),
          ),
        },
      );

      const confirming = yield* Effect.forkChild(confirmation(client));

      yield* committing.await;

      const interrupting = yield* Effect.forkChild(Fiber.interrupt(confirming));

      yield* proceed.open;
      yield* Fiber.join(interrupting);

      const withdrawn = Option.getOrThrow(yield* sealedKeyStore.readPublic());

      expect(approvals.filter(Option.isSome)).toHaveLength(0);
      expect(withdrawn.approvedUntil).toBeUndefined();
      expect(withdrawn.linkReceipt).toBeUndefined();
    }),
);

it.live(
  "replacing an expired order preserves a concurrent renewal of that order",
  () =>
    Effect.gen(function* () {
      const oldOrder = new TransferOrder({
        ...toExchange,
        id: Schema.decodeSync(TransferId)(crypto.randomUUID()),
        from: actors.sender,
      });

      const store = memoryKeyStore(
        Option.some(
          new DeviceWallet({
            ...actors.wallet,
            transfer: oldOrder,
            approvedUntil: nowSeconds() - 3600,
          }),
        ),
      );

      const renewedUntil = nowSeconds() + 120;
      let renewed = false;

      const port = unusedPort({
        transfer: (_order, approval) =>
          Effect.gen(function* () {
            if (!renewed) {
              renewed = true;

              yield* store
                .updatePublic((current) =>
                  Option.some(
                    new PublicDeviceWallet({
                      ...current,
                      approvedUntil: renewedUntil,
                    }),
                  ),
                )
                .pipe(Effect.orDie);
            }

            if (Option.isSome(approval))
              return yield* Effect.die("Must not approve");

            return transferDraftOf(
              payment(),
              new ExternalRecipient({ address: actors.exchange }),
            );
          }),
      });

      const outcome = yield* makeWalletEffects(port, store, passkeys).review(
        new TransferIntent({ ...toExchange, amount: otherAmount }),
      );

      expect(outcome._tag).toBe("ApprovalOutstanding");

      const kept = Option.getOrThrow(yield* store.readPublic());

      expect(kept.transfer?.id).toBe(oldOrder.id);
      expect(kept.approvedUntil).toBe(renewedUntil);
    }),
);
