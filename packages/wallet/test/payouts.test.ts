import { expect, layer } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AssetOrderId,
  type DestinationAddress,
  ExternalLinkOrder,
  InvalidAddress,
  LocalAmount,
  PayoutCompleted,
  type PayoutDestination,
  PayoutNotFound,
  PayoutOrder,
  PayoutProcessing,
  PayoutQuoteChanged,
  PayoutSending,
  PeruvianMobile,
  PixAccount,
  PixKey,
  YapeAccount,
} from "../src/contract";
import { Applied } from "../src/server/Chain.server";
import { assertTagged } from "./tagged";
import {
  accountState,
  addressOf,
  approve,
  draftedReceive,
  fundLink,
  partnerAddress,
  payoutCompletesAfter,
  settleHash,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./wallet-harness";
import { randomAddress } from "./test-keys";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "a payout claims the link to the simulated partner at the quote in its destination's currency, refuses another deposit address, a stale quote or another currency's quote, and completes after the partner's delay",
      () =>
        Effect.gen(function* () {
          const yape = {
            destination: YapeAccount.make({
              mobile: Schema.decodeSync(PeruvianMobile)("987654321"),
            }),
            local: LocalAmount.make({ currency: "PEN", minorUnits: 375n }),
          };

          const pix = {
            destination: PixAccount.make({
              key: Schema.decodeSync(PixKey)("camila@example.com"),
            }),
            local: LocalAmount.make({ currency: "BRL", minorUnits: 540n }),
          };

          world.accounts.set(partnerAddress, accountState());

          const pendingPayout = Effect.fn(function* (
            name: string,
            payee: { destination: PayoutDestination; local: LocalAmount },
            otherPayee: { destination: PayoutDestination; local: LocalAmount },
          ) {
            const { wallet, link, unclaimedFunds } = yield* fundLink(name);

            world.accounts.set(addressOf(link), accountState());

            const quote = yield* wallet.quotePayout(
              addressOf(link),
              payee.local.currency,
            );

            assertTagged(quote, "PayoutQuote");
            expect({
              local: quote.local,
              depositAddress: quote.depositAddress,
            }).toEqual({
              local: payee.local,
              depositAddress: partnerAddress,
            });

            const payoutTo = (
              destination: DestinationAddress,
              local: LocalAmount,
              to: PayoutDestination = payee.destination,
            ) =>
              new PayoutOrder({
                claim: new ExternalLinkOrder({
                  id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
                  link: addressOf(link),
                  unclaimedFunds,
                  destination,
                }),
                destination: to,
                local,
              });

            const elsewhere = randomAddress();

            expect(
              yield* wallet.requestPayout(
                payoutTo(elsewhere, quote.local),
                Option.none(),
              ),
            ).toEqual(new InvalidAddress({ address: elsewhere }));
            expect(
              yield* wallet.requestPayout(
                payoutTo(
                  quote.depositAddress,
                  LocalAmount.make({
                    currency: payee.local.currency,
                    minorUnits: payee.local.minorUnits + 25n,
                  }),
                ),
                Option.none(),
              ),
            ).toEqual(new PayoutQuoteChanged({ quote }));

            const otherCurrency = yield* wallet.requestPayout(
              payoutTo(
                quote.depositAddress,
                quote.local,
                otherPayee.destination,
              ),
              Option.none(),
            );

            assertTagged(otherCurrency, "PayoutQuoteChanged");
            expect(otherCurrency.quote.local).toEqual(otherPayee.local);

            const order = payoutTo(quote.depositAddress, quote.local);
            const drafted = yield* wallet.requestPayout(order, Option.none());

            assertTagged(drafted, "ExternalLinkDraft");

            const receive = Option.getOrThrow(draftedReceive(drafted.request));

            expect({
              destination: receive.destination,
              memo: receive.memo,
            }).toEqual({ destination: partnerAddress, memo: undefined });
            expect(yield* wallet.payout(order.claim.id)).toEqual(
              new PayoutNotFound(),
            );

            const beforeSubmit = world.submitted.length;

            assertTagged(
              yield* wallet.requestPayout(
                order,
                approve(drafted.request, link),
              ),
              "ExternalLinkPending",
            );
            expect(yield* wallet.payout(order.claim.id)).toEqual(
              new PayoutSending({ id: order.claim.id, local: quote.local }),
            );

            world.claimables.delete(unclaimedFunds);

            return {
              wallet,
              id: order.claim.id,
              hashes: world.submitted
                .slice(beforeSubmit)
                .map((sealed) => sealed.hash),
            };
          });

          const recent = yield* pendingPayout("payoutnow", yape, pix);

          for (const hash of recent.hashes) settleHash(hash);

          expect(yield* recent.wallet.payout(recent.id)).toEqual(
            new PayoutProcessing({ id: recent.id, local: yape.local }),
          );

          const earlier = yield* pendingPayout("payoutearly", pix, yape);

          const settledAt = DateTime.makeUnsafe(
            Date.now() - Duration.toMillis(payoutCompletesAfter) * 2,
          );

          for (const hash of earlier.hashes)
            world.evidence.set(hash, new Applied({ at: settledAt }));

          expect(yield* earlier.wallet.payout(earlier.id)).toEqual(
            new PayoutCompleted({
              id: earlier.id,
              local: pix.local,
              completedAt: DateTime.addDuration(
                settledAt,
                payoutCompletesAfter,
              ),
            }),
          );
        }),
    );
  },
);
