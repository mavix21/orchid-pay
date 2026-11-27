import { SQL } from "bun";
import type { Keypair } from "@stellar/stellar-sdk";
import { Database, databaseLayer } from "@workspace/db";
import { migrate } from "drizzle-orm/effect-postgres/migrator";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { type PaymentLinkIntent, type WalletClient } from "@workspace/wallet";
import { AssetOrders } from "../src/server/AssetOrders.server";
import { Backups } from "../src/server/Backups.server";
import { Chain } from "../src/server/Chain.server";
import { Deposits } from "../src/server/Deposits.server";
import { Directory } from "../src/server/Directory.server";
import { HumanCheck } from "../src/server/HumanCheck.server";
import { PayoutPartner } from "../src/server/PayoutPartner.server";
import { RateLimits } from "../src/server/RateLimits.server";
import { Transfers } from "../src/server/Transfers.server";
import { Wallet } from "../src/server/Wallet.server";
import { WalletSettings } from "../src/server/settings.server";
import { WorkQueue } from "../src/server/work-queue.server";

export const rpcUrl = "https://soroban-testnet.stellar.org";

const databaseUrl = (name: string) =>
  `postgres://orchid:orchid-local@127.0.0.1:55433/${name}`;

const liveDatabase = "wallet_live";

export const freshDatabase = async () => {
  const admin = new SQL(databaseUrl("postgres"));

  await admin.unsafe(`drop database if exists ${liveDatabase} with (force)`);
  await admin.unsafe(`create database ${liveDatabase}`);
  await admin.close();

  const layer = databaseLayer({ connectionString: databaseUrl(liveDatabase) });

  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database;

      yield* migrate(db, { migrationsFolder: `${import.meta.dir}/../drizzle` });
    }).pipe(Effect.provide(layer)),
  );

  return layer;
};

const acceptingHumanCheck = Layer.succeed(
  HumanCheck,
  HumanCheck.of({ verify: () => Effect.succeed(Option.none()) }),
);

const dependencies = Layer.mergeAll(
  acceptingHumanCheck,
  Chain.layer,
  Directory.layer,
  Transfers.layer,
  AssetOrders.layer,
  Backups.layer,
  Deposits.layer,
);

export const walletServices = (
  database: ReturnType<typeof databaseLayer>,
  settings: {
    sponsor: Keypair;
    feePayer: Keypair;
    passkeyOrigins: ReadonlyArray<string>;
  },
) =>
  Layer.merge(
    Wallet.serviceLayer.pipe(
      Layer.provide(dependencies),
      Layer.provide(PayoutPartner.sandbox(Duration.seconds(10))),
    ),
    dependencies,
  ).pipe(
    Layer.provide(WorkQueue.discarding),
    Layer.provide(RateLimits.unlimited),
    Layer.provide(
      Layer.succeed(WalletSettings, {
        rpcUrl,
        reserveSponsorSecret: Redacted.make(settings.sponsor.secret()),
        feePayerSecret: Redacted.make(settings.feePayer.secret()),
        passkeyOrigins: settings.passkeyOrigins,
        humanCheckSecret: Redacted.make("1x0000000000000000000000000000000AA"),
        sessionSecret: Redacted.make("live-session-secret"),
      }),
    ),
    Layer.provide(database),
    Layer.provide(FetchHttpClient.layer),
  );

export const fundLinkThroughReview = async (
  client: WalletClient,
  intent: PaymentLinkIntent,
) => {
  const reviewed = await client.reviewPaymentLink(intent);

  return Predicate.isTagged(reviewed, "PaymentReview")
    ? client.confirmPaymentLink(reviewed)
    : reviewed;
};
