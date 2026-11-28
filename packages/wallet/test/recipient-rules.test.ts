import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  type AccountAddress,
  AddressRecipient,
  RecipientCannotReceive,
  TransferOrder,
} from "../src/contract";
import { randomAddress } from "./test-keys";
import {
  addressOf,
  euro,
  euroLine,
  fundedWallet,
  holdingsFor,
  orderFor,
  send,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./wallet-harness";

useDisposableDatabase();

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect.each([
      {
        name: "an absent account",
        reason: "no_account",
        linkable: true,
        recipient: () => undefined,
      },
      {
        name: "a frozen token account",
        reason: "not_authorized",
        linkable: false,
        recipient: (address: AccountAddress) =>
          holdingsFor(address, {
            lines: [{ ...euroLine("0"), authorized: false }],
          }),
      },
    ] as const)(
      "refuses an external recipient with $name and links it: $linkable",
      ({ reason, linkable, recipient }) =>
        Effect.gen(function* () {
          const sender = yield* fundedWallet("linkoffer");
          const senderAddr = addressOf(sender);
          const destination = randomAddress();

          world.holdings.set(
            senderAddr,
            holdingsFor(senderAddr, {
              lines: [euroLine("50000000")],
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
