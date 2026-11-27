import { expect, layer } from "@effect/vitest";
import { Account, Keypair } from "@stellar/stellar-sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { leaseChannel } from "../src/stellar/channel-pool.server";
import { dbLayer, useDisposableDatabase } from "./stellar-harness";

useDisposableDatabase();

const channelAt = (address: string, sequence: string) =>
  new Account(address, sequence);

const leasedAddress = (leased: Option.Option<Account>) =>
  Option.map(leased, (channel) => channel.accountId());

const inTwoMinutes = () => new Date(Date.now() + 120_000);

layer(dbLayer, { excludeTestServices: true, concurrent: false })((it) => {
  it.effect(
    "hands each channel to one draft at a time until the pool is exhausted",
    () =>
      Effect.gen(function* () {
        const pool = [Keypair.random(), Keypair.random()].map((key) =>
          channelAt(key.publicKey(), "100"),
        );

        const leased = yield* Effect.all(
          [1, 2, 3].map(() => leaseChannel(pool, inTwoMinutes())),
          { concurrency: "unbounded" },
        );

        expect(
          leased.flatMap((channel) => Option.toArray(leasedAddress(channel))),
        ).toHaveLength(2);
        expect(
          new Set(leased.map(leasedAddress).map(Option.getOrNull)),
        ).toEqual(
          new Set([...pool.map((channel) => channel.accountId()), null]),
        );
      }),
  );

  it.effect.each([
    {
      name: "its draft expired unsubmitted",
      leasedUntil: new Date(Date.now() - 1000),
      sequenceAfter: "100",
    },
    {
      name: "the ledger consumed its sequence",
      leasedUntil: inTwoMinutes(),
      sequenceAfter: "101",
    },
  ])(
    "hands a leased channel to the next draft once $name",
    ({ leasedUntil, sequenceAfter }) =>
      Effect.gen(function* () {
        const address = Keypair.random().publicKey();

        yield* leaseChannel([channelAt(address, "100")], leasedUntil);

        const next = yield* leaseChannel(
          [channelAt(address, sequenceAfter)],
          inTwoMinutes(),
        );

        expect(leasedAddress(next)).toEqual(Option.some(address));
      }),
  );
});
