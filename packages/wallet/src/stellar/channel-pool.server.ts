import { Account, Keypair, hash } from "@stellar/stellar-sdk";
import { Database } from "@workspace/db";
import { lte, or } from "drizzle-orm";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AccountAddress } from "../contract";
import { ChainUnreachable } from "../server/chain-errors.server";
import type { AccountState } from "./ledger.server";
import { rpcReadConcurrency } from "../server/settings.server";
import { StoreFailure } from "../server/store-failure.server";
import { channelLeases } from "../server/tables.server";

export const channelCount = 8;

const ledgerCloseGrace = 30;

export const channelKeypair = (feePayer: Keypair, index: number) =>
  Keypair.fromRawEd25519Seed(
    hash(
      Buffer.concat([
        feePayer.rawSecretKey(),
        Buffer.from(`orchid channel ${index}`),
      ]),
    ),
  );

export const channelKeypairs = (feePayer: Keypair) =>
  Array.from({ length: channelCount }, (_, index) =>
    channelKeypair(feePayer, index),
  );

export const leaseChannel = Effect.fn("Chain.leaseChannel")(function* (
  candidates: ReadonlyArray<Account>,
  leasedUntil: Date,
) {
  const db = yield* Database;
  const now = new Date(DateTime.toEpochMillis(yield* DateTime.now));

  return yield* Effect.findFirst(candidates, (channel) => {
    const current = BigInt(channel.sequenceNumber());
    const lease = { sequence: current + 1n, leasedUntil };

    return db
      .insert(channelLeases)
      .values({ address: channel.accountId(), ...lease })
      .onConflictDoUpdate({
        target: channelLeases.address,
        set: lease,
        setWhere: or(
          lte(channelLeases.leasedUntil, now),
          lte(channelLeases.sequence, current),
        ),
      })
      .returning({ address: channelLeases.address })
      .pipe(
        Effect.map((leased) => leased.length > 0),
        Effect.mapError((cause) => new StoreFailure({ cause })),
      );
  });
});

export const channelPool = (
  feePayer: Keypair,
  db: EffectPgDatabase,
  account: (
    address: AccountAddress,
  ) => Effect.Effect<Option.Option<AccountState>, ChainUnreachable>,
) => {
  const channels = channelKeypairs(feePayer);

  const addresses = channels.map((channel) =>
    Schema.decodeSync(AccountAddress)(channel.publicKey()),
  );

  return {
    signer: (address: AccountAddress) =>
      Option.fromUndefinedOr(
        channels.find((channel) => channel.publicKey() === address),
      ),
    lease: Effect.fn("Chain.leaseChannelUntil")(function* (maxTime: number) {
      const opened = yield* Effect.forEach(
        addresses,
        (address) =>
          account(address).pipe(
            Effect.map(
              Option.map((state) => new Account(address, state.sequence)),
            ),
          ),
        { concurrency: rpcReadConcurrency },
      );

      const leased = yield* leaseChannel(
        opened.flatMap(Option.toArray),
        new Date((maxTime + ledgerCloseGrace) * 1000),
      ).pipe(Effect.provideService(Database, db));

      if (Option.isNone(leased))
        return yield* new ChainUnreachable({
          cause: new Error("Every channel is leased"),
        });

      return leased.value;
    }),
  };
};
