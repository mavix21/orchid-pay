import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  type AccountAddress,
  AddressRecipient,
  ExternalMemoRequired,
  RecipientCannotReceive,
  TransferOrder,
} from "../src/contract";
import { randomAddress, randomKey } from "./test-keys";
import {
  addressOf,
  approve,
  draftTransfer,
  euro,
  euroLine,
  exchanges,
  findTransfer,
  fundHolder,
  fundedWallet,
  holdingsFor,
  orderFor,
  send,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./wallet-harness";

useDisposableDatabase();

const registerExchange = (address: AccountAddress) => {
  const entry = {
    exchange: "Synthetic exchange fixture",
    source: "https://example.com/fixtures/memo-required",
  };

  exchanges.set(address, entry);

  return { address, ...entry };
};

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "known exchange destinations refuse missing memos with client-visible source evidence",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const entry = registerExchange(randomAddress());

          const order = orderFor(
            key,
            AddressRecipient.make({ value: entry.address }),
          );

          const initial = world.submitted.length;

          expect(yield* send(order)).toEqual(
            new ExternalMemoRequired({
              address: entry.address,
              exchange: entry.exchange,
              source: entry.source,
            }),
          );
          expect(Option.isNone(yield* findTransfer(order.id))).toBe(true);
          expect(world.submitted).toHaveLength(initial);
        }),
    );

    it.effect(
      "a new registry entry blocks an unsigned draft but preserves an authorized external transfer",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();
          const destKey = randomKey();

          fundHolder(destKey);
          const destination = addressOf(destKey);

          const order = orderFor(
            key,
            AddressRecipient.make({ value: destination }),
          );

          const draft = yield* draftTransfer(order);

          registerExchange(destination);
          expect((yield* send(order, approve(draft.request, key)))._tag).toBe(
            "ExternalMemoRequired",
          );
          expect(Option.getOrThrow(yield* findTransfer(order.id))._tag).toBe(
            "Proposed",
          );

          exchanges.clear();
          expect((yield* send(order, approve(draft.request, key)))._tag).toBe(
            "Pending",
          );

          registerExchange(destination);
          expect((yield* send(order))._tag).toBe("Pending");
        }),
    );

    it.effect.each([
      {
        name: "an absent account",
        reason: "no_account",
        linkable: true,
        authRequired: false,
        clawback: false,
        recipient: () => undefined,
      },
      {
        name: "a missing trustline",
        reason: "no_trustline",
        linkable: true,
        authRequired: false,
        clawback: false,
        recipient: (address: AccountAddress) =>
          holdingsFor(address, { lines: [] }),
      },
      {
        name: "an unauthorized trustline",
        reason: "not_authorized",
        linkable: false,
        authRequired: false,
        clawback: false,
        recipient: (address: AccountAddress) =>
          holdingsFor(address, {
            lines: [{ ...euroLine("0"), authorized: false }],
          }),
      },
      {
        name: "a missing trustline for an AUTH_REQUIRED issuer",
        reason: "no_trustline",
        linkable: false,
        authRequired: true,
        clawback: false,
        recipient: (address: AccountAddress) =>
          holdingsFor(address, { lines: [] }),
      },
      {
        name: "an absent account with clawback on the sender's trustline",
        reason: "no_account",
        linkable: false,
        authRequired: false,
        clawback: true,
        recipient: () => undefined,
      },
    ] as const)(
      "refuses an external recipient with $name and links it: $linkable",
      ({ reason, linkable, authRequired, clawback, recipient }) =>
        Effect.gen(function* () {
          const sender = yield* fundedWallet("linkoffer");
          const senderAddr = addressOf(sender);
          const destination = randomAddress();

          world.issuers.set(euro.id, { authRequired });
          world.holdings.set(
            senderAddr,
            holdingsFor(senderAddr, {
              lines: [{ ...euroLine("50000000"), clawbackEnabled: clawback }],
            }),
          );

          const held = recipient(destination);

          if (held !== undefined) world.holdings.set(destination, held);

          expect(
            yield* send(
              new TransferOrder({
                ...orderFor(
                  sender,
                  AddressRecipient.make({ value: destination }),
                ),
                asset: euro,
              }),
            ),
          ).toEqual(
            new RecipientCannotReceive({
              address: destination,
              reason,
              linkable,
            }),
          );
        }),
    );
  },
);
