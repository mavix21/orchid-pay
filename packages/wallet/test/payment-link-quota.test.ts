import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  UnclaimedFundsLimitReached,
  PaymentLinkRecipient,
  baseAsset,
} from "../src/contract";
import { Wallet } from "../src/server/Wallet.server";
import { Transfers } from "../src/server/Transfers.server";
import { sweepBatchSize } from "../src/policy";
import { assertTagged } from "./tagged";
import {
  accountState,
  addressOf,
  approve,
  assess,
  euroLine,
  fundedWallet,
  holdingsFor,
  orderFor,
  send,
  settleHash,
  sweep,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./wallet-harness";
import { randomAddress } from "./test-keys";

useDisposableDatabase();

const linkSender = Effect.gen(function* () {
  const sender = yield* fundedWallet("linkquota");
  const senderAddr = addressOf(sender);

  world.holdings.set(
    senderAddr,
    holdingsFor(senderAddr, {
      lines: [{ ...euroLine("500000000"), asset: baseAsset }],
    }),
  );

  const createLinkAt = Effect.fn(function* (sequence: string) {
    world.accounts.set(senderAddr, accountState({ sequence }));

    const linkKey = randomAddress();

    const order = orderFor(
      sender,
      PaymentLinkRecipient.make({ value: linkKey }),
    );

    const draft = yield* send(order);

    assertTagged(draft, "TransferDraft");

    const unclaimedFunds = Option.getOrThrow(
      Option.fromNullishOr(draft.unclaimedFunds),
    );

    expect((yield* send(order, approve(draft.request, sender)))._tag).toBe(
      "Pending",
    );

    const submitted = world.submitted.at(-1);

    if (!submitted) throw new Error("Expected submission");

    settleHash(submitted.hash);
    yield* sweep;

    return unclaimedFunds;
  });

  return { sender, senderAddr, createLinkAt };
});

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "the sweep closes one batch of gone payment link balances per run",
      () =>
        Effect.gen(function* () {
          const { senderAddr, createLinkAt } = yield* linkSender;

          yield* Effect.forEach(
            Array.from(
              { length: sweepBatchSize + 1 },
              (_, index) => `${2000 + index}`,
            ),
            createLinkAt,
          );

          world.claimables.clear();

          const open = Transfers.use((transfers) =>
            transfers.openClaimables(senderAddr, "paymentLink"),
          );

          yield* sweep;
          expect(yield* open).toBe(1);
          yield* sweep;
          expect(yield* open).toBe(0);
        }),
    );

    it.effect(
      "refuses the 6th open payment link while five are live and allows it once they are claimed",
      () =>
        Effect.gen(function* () {
          const { sender, senderAddr, createLinkAt } = yield* linkSender;

          const createdBalances = [
            yield* createLinkAt("2000"),
            yield* createLinkAt("2001"),
            yield* createLinkAt("2002"),
            yield* createLinkAt("2003"),
            yield* createLinkAt("2004"),
          ];

          world.accounts.set(senderAddr, accountState({ sequence: "2005" }));

          const sixth = yield* send(
            orderFor(
              sender,
              PaymentLinkRecipient.make({ value: randomAddress() }),
            ),
          );

          expect(sixth).toEqual(new UnclaimedFundsLimitReached({ limit: 5 }));

          const openLinks = yield* Wallet.use((w) =>
            w.paymentLinks(senderAddr),
          );

          assertTagged(openLinks, "OpenPaymentLinks");
          expect(openLinks.links.map((l) => l.unclaimedFunds).sort()).toEqual(
            [...createdBalances].sort(),
          );

          world.claimables.clear();
          assertTagged(
            yield* send(
              orderFor(
                sender,
                PaymentLinkRecipient.make({
                  value: randomAddress(),
                }),
              ),
            ),
            "TransferDraft",
          );
        }),
    );

    it.effect(
      "an assessment counts stored payment links and leaves gone ones for the next transfer to close",
      () =>
        Effect.gen(function* () {
          const { sender, senderAddr, createLinkAt } = yield* linkSender;

          yield* Effect.forEach(
            ["2000", "2001", "2002", "2003", "2004"],
            createLinkAt,
          );

          world.accounts.set(senderAddr, accountState({ sequence: "2005" }));
          world.claimables.clear();

          const sixth = orderFor(
            sender,
            PaymentLinkRecipient.make({ value: randomAddress() }),
          );

          expect(yield* assess(sender, sixth)).toEqual(
            new UnclaimedFundsLimitReached({ limit: 5 }),
          );
          expect(
            yield* Transfers.use((transfers) =>
              transfers.openClaimables(senderAddr, "paymentLink"),
            ),
          ).toBe(5);
          assertTagged(yield* send(sixth), "TransferDraft");
        }),
    );
  },
);
