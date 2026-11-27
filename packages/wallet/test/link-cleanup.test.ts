import { expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { CleanUpReceivedLink } from "../src/server/work-queue.server";
import { assertTagged } from "./tagged";
import {
  fundLink,
  accountState,
  addressOf,
  attend,
  fundedWallet,
  sweep,
  useDisposableDatabase,
  walletTestLayer,
  world,
  receiveInto,
} from "./wallet-harness";

useDisposableDatabase();

const receivedLink = Effect.fn(function* (name: string) {
  const funded = yield* fundLink(name);
  const recipient = yield* fundedWallet(`${name}rcv`);
  const receive = yield* receiveInto(funded.wallet, recipient, funded);

  return { address: addressOf(funded.link), receive };
});

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "a cleanup message merges a received link account and retries until it is gone",
      () =>
        Effect.gen(function* () {
          const { address, receive } = yield* receivedLink("cleanup");
          const message = new CleanUpReceivedLink({ id: receive.id });

          expect(world.queued).toContainEqual(message);
          world.accounts.set(address, accountState());
          assertTagged(yield* attend(message), "WorkRetry");
          expect(world.accounts.has(address)).toBe(false);
          assertTagged(yield* attend(message, 2), "WorkFinished");
        }),
    );

    it.effect(
      "a received link that cannot be merged does not block the cleanup of newer links",
      () =>
        Effect.gen(function* () {
          const stuck = yield* Effect.forEach(
            ["blockedone", "blockedtwo", "blockedthree", "blockedfour"],
            (name) =>
              Effect.gen(function* () {
                const { address } = yield* receivedLink(name);

                world.unmergeable.add(address);
                world.accounts.set(address, accountState());

                return address;
              }),
          );

          const { address: newest } = yield* receivedLink("blockedfive");

          world.accounts.set(newest, accountState());
          yield* sweep;

          expect(world.accounts.has(newest)).toBe(false);

          for (const address of stuck)
            expect(world.accounts.has(address)).toBe(true);
        }),
    );
  },
);
