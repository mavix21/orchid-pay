import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Latch from "effect/Latch";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  UnclaimedFundsGone,
  Offline,
  PaymentLinkNotFound,
  PaymentLinkReceipt,
  PaymentLinkRecipient,
  PositiveAmount,
  RecipientCannotReceive,
  TransferOrder,
  type WalletPort,
  baseAsset,
} from "../src/contract";
import { browserKeyStore } from "../src/device/browser-key-store";
import {
  DraftRejected,
  PaymentLinkIntent,
  type WalletEffects,
  makeWalletEffects,
} from "../src/device/client";
import { linkAddressOf } from "../src/device/link-code";
import { Transfers } from "../src/server/Transfers.server";
import {
  DeviceWallet,
  memoryKeyStore,
  savedWallet,
  signingKey,
} from "./device-fixtures";
import {
  approvingDevice,
  installSealedWallet,
  sealedKeyStore,
} from "./sealed-wallet-fixtures";
import { network } from "../src/device-network";
import { assertTagged } from "./tagged";
import { randomAddress, randomKey, randomUnclaimedFundsId } from "./test-keys";
import {
  settleOnSubmit,
  amount,
  approve,
  devicePasskeys,
  euroLine,
  holdingsFor,
  openSender,
  orderFor,
  settleHash,
  sweep,
  useDisposableDatabase,
  walletTestLayer,
  world,
  recordUnclaimedFunds,
} from "./solana-harness";

const linkAmount = Schema.decodeSync(PositiveAmount)("1000000");

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect.each([
      {
        name: "resolving the receipt",
        reconcile: (client: WalletEffects) =>
          client
            .resolvePaymentLink()
            .pipe(
              Effect.map((resolved) =>
                Predicate.isTagged(resolved, "LatestPaymentLink")
                  ? resolved.savedOnDevice
                  : resolved._tag,
              ),
            ),
        reconciled: true,
      },
      {
        name: "starting another link before visiting the links",
        reconcile: (client: WalletEffects) =>
          client
            .reviewPaymentLink(
              new PaymentLinkIntent({
                asset: baseAsset,
                amount: linkAmount,
                saveOnDevice: false,
              }),
            )
            .pipe(Effect.map((reviewed) => reviewed._tag)),
        reconciled: "PaymentReview",
      },
    ])(
      "a restarted creation records the unclaimed funds funded before an interrupted approval by $name and re-shares its link",
      ({ reconcile, reconciled }) =>
        Effect.gen(function* () {
          const store = memoryKeyStore();
          const { wallet, sender } = yield* openSender(store, "receiptowner");

          const interruptedPort: WalletPort = {
            ...wallet,
            transfer: (nextOrder, approval) =>
              Option.isSome(approval)
                ? settleOnSubmit(wallet, sender.address)(
                    nextOrder,
                    approval,
                  ).pipe(Effect.andThen(Effect.fail(new Offline())))
                : wallet.transfer(nextOrder, approval),
          };

          const { auth } = yield* installSealedWallet(sender);

          const interrupted = makeWalletEffects(
            interruptedPort,
            sealedKeyStore,
            devicePasskeys,
            approvingDevice(auth),
          );

          const review = yield* interrupted.reviewPaymentLink(
            new PaymentLinkIntent({
              asset: baseAsset,
              amount: linkAmount,
              saveOnDevice: true,
            }),
          );

          assertTagged(review, "PaymentReview");
          expect(yield* interrupted.confirmPaymentLink(review)).toEqual(
            new Offline(),
          );

          const savedAfterCrash = yield* savedWallet(sealedKeyStore);

          const funded = Option.getOrThrow(
            Option.fromNullishOr(savedAfterCrash.linkReceipt),
          );

          expect(funded.attempts).toHaveLength(1);
          expect(
            (yield* browserKeyStore.readLinks()).map((link) => ({
              address: link.address,
              unclaimedFunds: link.unclaimedFunds,
            })),
          ).toEqual([{ address: funded.address, unclaimedFunds: undefined }]);

          const restartedDevice = makeWalletEffects(
            wallet,
            sealedKeyStore,
            devicePasskeys,
            approvingDevice(auth),
          );

          world.holdings.set(
            sender.address,
            holdingsFor(sender.address, {
              lines: [{ ...euroLine("500000000"), asset: baseAsset }],
            }),
          );

          expect(yield* reconcile(restartedDevice)).toBe(reconciled);
          expect(
            (yield* browserKeyStore.readLinks()).map((link) => ({
              address: link.address,
              unclaimedFunds: link.unclaimedFunds,
            })),
          ).toEqual([
            { address: funded.address, unclaimedFunds: funded.unclaimedFunds },
          ]);

          const revealed = yield* restartedDevice.revealPaymentLink({
            address: funded.address,
            unclaimedFunds: funded.unclaimedFunds,
            asset: funded.asset,
            amount: funded.amount,
          });

          assertTagged(revealed, "PaymentLinkRevealed");
          expect(linkAddressOf(revealed.code)).toEqual(
            Option.some(funded.address),
          );
          expect(revealed.path).toBe(`/r#${revealed.code}`);

          const competingMiss = yield* wallet.resolvePaymentLink(
            sender.address,
            new PaymentLinkReceipt({
              network,
              address: randomAddress(),
              asset: baseAsset,
              amount: linkAmount,
              unclaimedFunds: funded.unclaimedFunds,
              attempts: [funded.unclaimedFunds],
            }),
          );

          expect(competingMiss).toEqual(new PaymentLinkNotFound());
        }),
    );

    it.effect(
      "restarted device resolves live unclaimed funds while transfer reconciliation stays Pending, and preserves Pending when absent",
      () =>
        Effect.gen(function* () {
          const store = memoryKeyStore();
          const { wallet, sender } = yield* openSender(store, "pendinglink");

          const pendingPort: WalletPort = {
            ...wallet,
            transfer: (nextOrder, approval) =>
              Option.isSome(approval)
                ? wallet
                    .transfer(nextOrder, approval)
                    .pipe(Effect.andThen(Effect.fail(new Offline())))
                : wallet.transfer(nextOrder, approval),
          };

          const { auth } = yield* installSealedWallet(sender);

          const pending = makeWalletEffects(
            pendingPort,
            sealedKeyStore,
            devicePasskeys,
            approvingDevice(auth),
          );

          const review = yield* pending.reviewPaymentLink(
            new PaymentLinkIntent({
              asset: baseAsset,
              amount: linkAmount,
              saveOnDevice: true,
            }),
          );

          assertTagged(review, "PaymentReview");
          expect(yield* pending.confirmPaymentLink(review)).toEqual(
            new Offline(),
          );

          const linkAddr = Schema.decodeSync(AccountAddress)(review.to);
          const saved = yield* savedWallet(sealedKeyStore);

          const receipt = Option.getOrThrow(
            Option.fromNullishOr(saved.linkReceipt),
          );

          const restarted = makeWalletEffects(
            wallet,
            sealedKeyStore,
            devicePasskeys,
            approvingDevice(auth),
          );

          const savedFunding = Effect.map(
            browserKeyStore.readLinks(),
            (links) => links.map((link) => link.unclaimedFunds),
          );

          assertTagged(yield* restarted.resolvePaymentLink(), "Pending");
          expect(yield* savedFunding).toEqual([undefined]);
          expect(
            (yield* savedWallet(sealedKeyStore)).linkReceipt?.unclaimedFunds,
          ).toBe(receipt.unclaimedFunds);

          recordUnclaimedFunds({
            unclaimedFunds: receipt.unclaimedFunds,
            link: linkAddr,
            sender: sender.address,
            amount: linkAmount,
          });

          const resolved = yield* restarted.resolvePaymentLink();

          assertTagged(resolved, "LatestPaymentLink");
          expect(resolved.unclaimedFunds).toBe(receipt.unclaimedFunds);
          expect(resolved.address).toBe(linkAddr);
          expect(resolved.savedOnDevice).toBe(true);
          expect(yield* savedFunding).toEqual([receipt.unclaimedFunds]);

          const cancelSettlingPort: WalletPort = {
            ...wallet,
            manage: (order, approval) =>
              wallet.manage(order, approval).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    const sealed = world.submitted.at(-1);

                    if (Option.isSome(approval) && sealed) {
                      settleHash(sealed.hash);
                      world.claimables.delete(resolved.unclaimedFunds);
                    }
                  }),
                ),
              ),
          };

          const held = yield* Latch.make();
          const released = yield* Latch.make();
          let holdFirstPreflight = true;

          const holdingPort: WalletPort = {
            ...cancelSettlingPort,
            manage: (order, approval) => {
              if (!holdFirstPreflight || Option.isSome(approval))
                return cancelSettlingPort.manage(order, approval);

              holdFirstPreflight = false;

              return held.open.pipe(
                Effect.andThen(released.await),
                Effect.andThen(cancelSettlingPort.manage(order, approval)),
              );
            },
          };

          const reclaiming = makeWalletEffects(
            holdingPort,
            sealedKeyStore,
            devicePasskeys,
            approvingDevice(auth),
          );

          const lateReview = yield* Effect.forkChild(
            reclaiming.reviewReclaim(resolved),
          );

          yield* held.await;

          expect(
            yield* reclaiming.reviewReclaim({
              ...resolved,
              unclaimedFunds: randomUnclaimedFundsId(),
            }),
          ).toEqual(new UnclaimedFundsGone({ status: "unresolved" }));
          expect(yield* savedFunding).toEqual([receipt.unclaimedFunds]);

          yield* released.open;

          expect(yield* Fiber.join(lateReview)).toEqual(new DraftRejected());

          const superseded = yield* reclaiming.reviewReclaim(resolved);
          const current = yield* reclaiming.reviewReclaim(resolved);
          const fundingPrompts = auth.requested.length;

          assertTagged(superseded, "ReclaimReview");
          assertTagged(current, "ReclaimReview");

          expect(yield* reclaiming.confirmReclaim(superseded)).toEqual(
            new DraftRejected(),
          );
          expect(auth.requested).toHaveLength(fundingPrompts);

          expect(yield* savedFunding).toEqual([receipt.unclaimedFunds]);
          assertTagged(
            yield* reclaiming.confirmReclaim(current),
            "AssetSettled",
          );
          expect(yield* savedFunding).toEqual([]);
          expect(auth.requested).toHaveLength(fundingPrompts + 1);
        }),
    );

    it.effect(
      "reclaim review checks sender receive capacity, marks absent unclaimed funds unresolved, and never hides an unsettled link",
      () =>
        Effect.gen(function* () {
          const store = memoryKeyStore();
          const { wallet, sender } = yield* openSender(store, "cancelowner");
          const linkAddr = randomAddress();

          const unclaimedFunds = randomUnclaimedFundsId();

          recordUnclaimedFunds({
            unclaimedFunds,
            link: linkAddr,
            sender: sender.address,
            amount: linkAmount,
          });

          world.holdings.set(
            sender.address,
            holdingsFor(sender.address, {
              lines: [
                {
                  ...euroLine("0", { capacity: amount("999999") }),
                  asset: baseAsset,
                },
              ],
            }),
          );

          const client = makeWalletEffects(wallet, store, devicePasskeys);

          expect(
            yield* client.reviewReclaim({
              unclaimedFunds,
              asset: baseAsset,
              amount: linkAmount,
            }),
          ).toEqual(
            new RecipientCannotReceive({
              address: sender.address,
              reason: "no_capacity",
            }),
          );

          world.claimables.delete(unclaimedFunds);

          expect(
            yield* client.reviewReclaim({
              unclaimedFunds,
              asset: baseAsset,
              amount: linkAmount,
            }),
          ).toEqual(new UnclaimedFundsGone({ status: "unresolved" }));

          world.holdings.delete(sender.address);

          const inflightLink = randomAddress();

          const inflightOrder = new TransferOrder({
            ...orderFor(
              randomKey(),
              PaymentLinkRecipient.make({ value: inflightLink }),
            ),
            from: sender.address,
          });

          const draft = yield* wallet.transfer(inflightOrder, Option.none());

          assertTagged(draft, "TransferDraft");

          const inflightBalance = Option.getOrThrow(
            Option.fromNullishOr(draft.unclaimedFunds),
          );

          expect(
            yield* client.reviewReclaim({
              unclaimedFunds: inflightBalance,
              asset: baseAsset,
              amount: linkAmount,
            }),
          ).toEqual(new UnclaimedFundsGone({ status: "unresolved" }));

          const senderKey = signingKey(sender.phrase);

          assertTagged(
            yield* wallet.transfer(
              inflightOrder,
              approve(draft.request, senderKey),
            ),
            "Pending",
          );

          yield* Transfers.use((t) => t.closeUnclaimedFunds(inflightBalance));

          const submitted = Option.getOrThrow(
            Option.fromNullishOr(world.submitted.at(-1)),
          );

          recordUnclaimedFunds({
            unclaimedFunds: inflightBalance,
            link: inflightLink,
            sender: sender.address,
            amount: linkAmount,
          });
          settleHash(submitted.hash);
          yield* sweep;

          const open = yield* wallet.paymentLinks(sender.address);

          assertTagged(open, "OpenPaymentLinks");
          expect(open.links.map((item) => item.unclaimedFunds)).toEqual([
            inflightBalance,
          ]);
        }),
    );

    it.effect(
      "stale recovery cleanup for link A does not erase a newer approved link B",
      () =>
        Effect.gen(function* () {
          const store = memoryKeyStore();
          const { wallet, sender } = yield* openSender(store, "raceowner");
          const linkA = randomAddress();
          const linkB = randomAddress();

          const balanceA = randomUnclaimedFundsId();

          const balanceB = randomUnclaimedFundsId();

          const orderA = new TransferOrder({
            ...orderFor(
              randomKey(),
              PaymentLinkRecipient.make({ value: linkA }),
            ),
            from: sender.address,
          });

          const orderB = new TransferOrder({
            ...orderFor(
              randomKey(),
              PaymentLinkRecipient.make({ value: linkB }),
            ),
            from: sender.address,
          });

          const receiptA = new PaymentLinkReceipt({
            network,
            address: linkA,
            asset: baseAsset,
            amount: linkAmount,
            unclaimedFunds: balanceA,
            attempts: [balanceA],
          });

          const receiptB = new PaymentLinkReceipt({
            network,
            address: linkB,
            asset: baseAsset,
            amount: linkAmount,
            unclaimedFunds: balanceB,
            attempts: [balanceB],
          });

          recordUnclaimedFunds({
            unclaimedFunds: balanceA,
            link: linkA,
            sender: sender.address,
            amount: linkAmount,
          });
          recordUnclaimedFunds({
            unclaimedFunds: balanceB,
            link: linkB,
            sender: sender.address,
            amount: linkAmount,
          });

          yield* store.seed(
            new DeviceWallet({
              ...sender,
              transfer: orderA,
              approvedUntil: Math.floor(Date.now() / 1000) + 120,
              linkReceipt: receiptA,
            }),
          );

          const started = yield* Latch.make();
          const release = yield* Latch.make();

          const heldPort: WalletPort = {
            ...wallet,
            resolvePaymentLink: (addr, receipt) =>
              started.open.pipe(
                Effect.andThen(release.await),
                Effect.andThen(wallet.resolvePaymentLink(addr, receipt)),
              ),
          };

          const resolvingA = yield* Effect.forkChild(
            makeWalletEffects(
              heldPort,
              store,
              devicePasskeys,
            ).resolvePaymentLink(),
          );

          yield* started.await;

          yield* store.seed(
            new DeviceWallet({
              ...sender,
              transfer: orderB,
              approvedUntil: Math.floor(Date.now() / 1000) + 180,
              linkReceipt: receiptB,
            }),
          );

          yield* release.open;

          const resolvedA = yield* Fiber.join(resolvingA);

          assertTagged(resolvedA, "LatestPaymentLink");
          expect(resolvedA.unclaimedFunds).toBe(balanceA);

          const storedAfterA = yield* savedWallet(store);

          expect(storedAfterA.transfer?.id).toBe(orderB.id);
          expect(storedAfterA.linkReceipt?.unclaimedFunds).toBe(balanceB);

          const resolvedB = yield* makeWalletEffects(
            wallet,
            store,
            devicePasskeys,
          ).resolvePaymentLink();

          assertTagged(resolvedB, "LatestPaymentLink");
          expect(resolvedB.unclaimedFunds).toBe(balanceB);
          expect(resolvedB.address).toBe(linkB);
        }),
    );
  },
);
