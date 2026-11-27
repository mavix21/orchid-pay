import { expect, layer } from "@effect/vitest";
import { Keypair } from "@stellar/stellar-sdk";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  Offline,
  PaymentRequestBeingPaid,
  PaymentRequestId,
  PaymentRequestOpen,
  PositiveAmount,
  Settled,
  TransferIntent,
  Username,
  UsernameRecipient,
  type WalletPort,
  baseAsset,
} from "../src/contract";
import { makeWalletEffects } from "../src/device/client";
import { makeRequestPaymentEffects } from "../src/device/payment-requests";
import { DeviceWallet, memoryKeyStore } from "./device-fixtures";
import {
  approvingDevice,
  installSealedWallet,
  sealedKeyStore,
} from "./sealed-wallet-fixtures";
import { assertTagged } from "./tagged";
import {
  settleOnSubmit,
  create,
  devicePasskeys,
  euro,
  euroLine,
  holdingsFor,
  openSender,
  reserveSponsor,
  settleHash,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./stellar-harness";

const toPedro = new TransferIntent({
  to: UsernameRecipient.make({ value: Schema.decodeSync(Username)("pedro") }),
  asset: baseAsset,
  amount: Schema.decodeSync(PositiveAmount)("10000000"),
});

const reviewedAndConfirmed = Effect.fn(function* (
  client: ReturnType<typeof makeWalletEffects>,
  intent: TransferIntent,
) {
  const review = yield* client.review(intent);

  assertTagged(review, "PaymentReview");

  return yield* client.confirm(review);
});

const requestForPedro = (id: string) =>
  new PaymentRequestOpen({
    id: Schema.decodeSync(PaymentRequestId)(id),
    requester: Schema.decodeSync(Username)("pedro"),
    asset: toPedro.asset,
    amount: toPedro.amount,
    note: undefined,
    createdAt: DateTime.nowUnsafe(),
  });

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "replays the stored order after a reload and settles it once",
      () =>
        Effect.gen(function* () {
          yield* create(Keypair.random(), "pedro");
          const { wallet, sender } = yield* openSender(memoryKeyStore());
          const { auth } = yield* installSealedWallet(sender);

          const reloaded: WalletPort = {
            ...wallet,
            transfer: (order, approval) =>
              Option.isSome(approval)
                ? wallet
                    .transfer(order, approval)
                    .pipe(Effect.andThen(Effect.fail(new Offline())))
                : wallet.transfer(order, approval),
          };

          expect(
            (yield* reviewedAndConfirmed(
              makeWalletEffects(
                reloaded,
                sealedKeyStore,
                devicePasskeys,
                approvingDevice(auth),
              ),
              toPedro,
            ))._tag,
          ).toBe("Offline");

          const stored = Option.getOrThrow(
            yield* sealedKeyStore.readPublic(),
          ).transfer;

          const sealed = world.submitted.at(-1);
          const submissions = world.submitted.length;

          if (!stored || !sealed) throw new Error("Expected a signed order");

          settleHash(sealed.hash);

          const replayed = yield* makeWalletEffects(
            wallet,
            sealedKeyStore,
            devicePasskeys,
            approvingDevice(auth),
          ).review(toPedro);

          expect(replayed instanceof Settled && replayed.id).toBe(stored.id);
          expect(world.submitted).toHaveLength(submissions);
        }),
    );

    it.effect(
      "a restored wallet learns its reserve sponsor from overview and approves a claimable",
      () =>
        Effect.gen(function* () {
          yield* create(Keypair.random(), "pedro");
          const { wallet, sender } = yield* openSender(memoryKeyStore());

          world.holdings.set(
            sender.address,
            holdingsFor(sender.address, {
              reserveSponsor: Option.some(reserveSponsor),
              lines: [euroLine("50000000")],
            }),
          );

          const { auth } = yield* installSealedWallet(
            new DeviceWallet({ ...sender, reserveSponsor: undefined }),
          );

          const settledPort: WalletPort = {
            ...wallet,
            transfer: settleOnSubmit(wallet, sender.address),
          };

          const client = makeWalletEffects(
            settledPort,
            sealedKeyStore,
            devicePasskeys,
            approvingDevice(auth),
          );

          yield* client.overview();

          const sent = yield* reviewedAndConfirmed(
            client,
            new TransferIntent({ ...toPedro, asset: euro }),
          );

          expect(
            sent instanceof Settled && sent.unclaimedFunds !== undefined,
          ).toBe(true);
        }),
    );

    it.effect(
      "keeps a request payment on its own order and withdraws the approval a request refuses",
      () =>
        Effect.gen(function* () {
          yield* create(Keypair.random(), "pedro");
          const { wallet, sender } = yield* openSender(memoryKeyStore());
          const { auth } = yield* installSealedWallet(sender);
          const device = approvingDevice(auth);

          const sending = makeWalletEffects(
            wallet,
            sealedKeyStore,
            devicePasskeys,
            device,
          );

          const requests = makeRequestPaymentEffects(
            wallet,
            {
              pay: (_, order, approval) =>
                Option.isSome(approval)
                  ? Effect.succeed(new PaymentRequestBeingPaid())
                  : wallet.transfer(order, approval),
            },
            sealedKeyStore,
            device,
          );

          const first = requestForPedro("aaaaaaaaaa");
          const second = requestForPedro("bbbbbbbbbb");

          const reviewedId = Effect.fn(function* (
            review: ReturnType<typeof requests.review>,
          ) {
            const reviewed = yield* review;

            assertTagged(reviewed, "PaymentReview");

            return reviewed.order.id;
          });

          const sent = yield* reviewedId(sending.review(toPedro));
          const paidFirst = yield* reviewedId(requests.review(first));
          const paidSecond = yield* reviewedId(requests.review(second));

          expect(yield* reviewedId(requests.review(second))).toBe(paidSecond);

          const sentAgain = yield* reviewedId(sending.review(toPedro));

          expect(new Set([sent, paidFirst, paidSecond, sentAgain]).size).toBe(
            4,
          );

          const review = yield* requests.review(first);

          assertTagged(review, "PaymentReview");
          expect(yield* requests.confirm(first.id, review)).toEqual(
            new PaymentRequestBeingPaid(),
          );

          const stored = Option.getOrThrow(yield* sealedKeyStore.readPublic());

          expect(stored.transfer?.id).toBe(review.order.id);
          expect(stored.approvedUntil).toBeUndefined();
        }),
    );
  },
);
