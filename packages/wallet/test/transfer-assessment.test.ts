import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  AddressRecipient,
  ExternalRecipient,
  InvalidAddress,
  PhoneNotSupported,
  PhoneRecipient,
  Profile,
  RecipientCheck,
  UnknownRecipient,
  Username,
  UsernameRecipient,
} from "../src/contract";
import { Transfers } from "../src/server/Transfers.server";
import { assertTagged } from "./tagged";
import {
  addressOf,
  assess,
  authorizeTransfer,
  checkRecipient,
  exchanges,
  draftTransfer,
  findWallet,
  fundedWallet,
  selfOrder,
  settleHash,
  storedTransfers,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./wallet-harness";
import { randomAddress } from "./test-keys";

useDisposableDatabase();

const username = Schema.decodeSync(Username);

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect("an assessed intent predicts the draft and stores nothing", () =>
      Effect.gen(function* () {
        const key = yield* fundedWallet();
        const order = selfOrder(key);
        const assessment = yield* assess(key, order);

        assertTagged(assessment, "TransferAssessment");
        expect(yield* storedTransfers(addressOf(key))).toEqual([]);

        const draft = yield* draftTransfer(order);

        expect(draft.recipient).toEqual(assessment.recipient);
        expect(draft.memoRequired).toBe(assessment.memoRequired);
      }),
    );

    it.effect(
      "an assessment reports a signed transfer still in flight without reconciling it",
      () =>
        Effect.gen(function* () {
          const key = yield* fundedWallet();

          const { authorized } = yield* authorizeTransfer(key, selfOrder(key), {
            failSubmit: true,
          });

          settleHash(authorized.sealed.hash);

          const submissions = world.submitted.length;

          assertTagged(yield* assess(key, selfOrder(key)), "SenderBusy");
          expect(world.submitted).toHaveLength(submissions);
          assertTagged(
            Option.getOrThrow(
              yield* Transfers.use((transfers) =>
                transfers.latestFrom(addressOf(key)),
              ),
            ),
            "Authorized",
          );
        }),
    );

    it.effect("an assessment leaves a vanished account's wallet active", () =>
      Effect.gen(function* () {
        const key = yield* fundedWallet();

        world.accounts.delete(addressOf(key));
        assertTagged(yield* assess(key, selfOrder(key)), "NotOpened");
        expect(
          Option.getOrThrow(yield* findWallet(addressOf(key))).status,
        ).toBe("active");
      }),
    );

    it.effect("a recipient check reports who receives and what they need", () =>
      Effect.gen(function* () {
        const target = yield* fundedWallet("pedro");

        const address = randomAddress();

        const exchange = {
          exchange: "Synthetic exchange fixture",
          source: "https://example.com/fixtures/memo-required",
        };

        exchanges.set(address, exchange);

        expect(
          yield* checkRecipient(
            UsernameRecipient.make({ value: username("pedro") }),
          ),
        ).toEqual(
          new RecipientCheck({
            recipient: new Profile({
              username: username("pedro"),
              address: addressOf(target),
            }),
            memoRequired: false,
            exchange: Option.none(),
          }),
        );
        expect(
          yield* checkRecipient(AddressRecipient.make({ value: address })),
        ).toEqual(
          new RecipientCheck({
            recipient: new ExternalRecipient({ address }),
            memoRequired: true,
            exchange: Option.some(exchange.exchange),
          }),
        );
      }),
    );

    const invalidAddress = Schema.decodeSync(AccountAddress)(
      `G${"A".repeat(55)}`,
    );

    it.effect.each([
      {
        name: "an unregistered username",
        to: UsernameRecipient.make({ value: username("nobody") }),
        expected: new UnknownRecipient({ username: username("nobody") }),
      },
      {
        name: "a phone number",
        to: PhoneRecipient.make({ value: "+15550100" }),
        expected: new PhoneNotSupported(),
      },
      {
        name: "an address with a bad checksum",
        to: AddressRecipient.make({ value: invalidAddress }),
        expected: new InvalidAddress({ address: invalidAddress }),
      },
    ])("a recipient check refuses $name", ({ to, expected }) =>
      Effect.gen(function* () {
        expect(yield* checkRecipient(to)).toEqual(expected);
      }),
    );
  },
);
