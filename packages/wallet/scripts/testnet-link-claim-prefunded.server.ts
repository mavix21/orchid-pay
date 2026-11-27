import assert from "node:assert/strict";
import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  AssetSettled,
  DestinationAddress,
  ExternalLinkIntent,
  ExternalLinkReview,
  ExternalLinkSettled,
  Holding,
  LinkReceiveReview,
  PaymentLinkCreated,
  PaymentLinkIntent,
  PositiveAmount,
  type KeyStore,
  SealedDeviceWallet,
  type SealedKeyStore,
  type SealedLinkCode,
  baseAsset,
  makeEnrollmentEffects,
  makeWalletClient,
  sameAsset,
} from "@workspace/wallet";
import { Wallet } from "../src/server/Wallet.server";
import { networkPassphrase, usdc } from "../src/stellar/network";
import { SoftwareAuthenticator } from "../test/software-authenticator";
import {
  fundLinkThroughReview,
  freshDatabase,
  walletServices,
} from "./live.server";
import {
  fundWithFriendbot,
  fundWithUsdc,
  horizon,
  openChannels,
} from "./testnet-funding";

const sponsor = Keypair.random();
const feePayer = Keypair.random();
const passkeyOrigin = "http://localhost:3000";

const relyingParty = {
  origin: passkeyOrigin,
  rpId: new URL(passkeyOrigin).hostname,
};

const runtime = ManagedRuntime.make(
  walletServices(await freshDatabase(), {
    sponsor,
    feePayer,
    passkeyOrigins: [passkeyOrigin],
  }),
);

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

await Promise.all(
  [sponsor, feePayer].map((key) => fundWithFriendbot(key.publicKey())),
);

await openChannels(sponsor.secret(), feePayer.secret());

const walletService = await runtime.runPromise(Wallet);

const memorySealedKeyStore = (): SealedKeyStore => {
  let saved = Option.none<SealedDeviceWallet>();
  let links: ReadonlyArray<SealedLinkCode> = [];

  return {
    readLinks: () => Effect.sync(() => links),
    updateRecords: (update) =>
      Effect.sync(() =>
        Option.map(saved, (stored) => {
          const current = { wallet: stored.public, links };
          const next = update(current);

          if (Option.isNone(next)) return { records: current, updated: false };

          saved = Option.some(
            new SealedDeviceWallet({ ...stored, public: next.value.wallet }),
          );
          links = next.value.links;

          return { records: next.value, updated: true };
        }),
      ),
    readPublic: () => Effect.sync(() => Option.map(saved, (s) => s.public)),
    updatePublic: (update) =>
      Effect.sync(() =>
        Option.map(saved, (stored) => {
          const next = update(stored.public);

          if (Option.isNone(next))
            return { wallet: stored.public, updated: false };

          saved = Option.some(
            new SealedDeviceWallet({ ...stored, public: next.value }),
          );

          return { wallet: next.value, updated: true };
        }),
      ),
    readSealed: () => Effect.sync(() => saved),
    writeSealed: (wallet) =>
      Effect.sync(() => {
        saved = Option.some(wallet);
      }),
    installSealed: (wallet) =>
      Effect.sync(() => {
        if (Option.isSome(saved)) return false;

        saved = Option.some(wallet);

        return true;
      }),
  };
};

const newClient = async (name: string) => {
  const sealed = memorySealedKeyStore();
  const auth = new SoftwareAuthenticator(passkeyOrigin);

  const enrollment = makeEnrollmentEffects({
    port: walletService,
    store: sealed,
    registration: auth.registration,
    assertions: auth.assertions,
    relyingParty,
  });

  const username = `${name}_${crypto.randomUUID().replaceAll("-", "").slice(0, 6)}`;
  const started = await Effect.runPromise(enrollment.start(username));

  assert.ok(
    Predicate.isTagged(started, "EnrollmentPending"),
    `Expected EnrollmentPending, got ${started._tag}`,
  );

  const enrolled = await Effect.runPromise(enrollment.advance(started.review));

  assert.ok(
    Predicate.isTagged(enrolled, "WalletEnrolled"),
    `Expected WalletEnrolled, got ${enrolled._tag}`,
  );

  const store: KeyStore = {
    readPublic: () => Effect.orDie(sealed.readPublic()),
    updatePublic: (update) => Effect.orDie(sealed.updatePublic(update)),
  };

  const client = makeWalletClient(walletService, store, auth.passkeys, {
    store: sealed,
    ceremony: auth.assertions,
    relyingParty: () => relyingParty,
  });

  const wallet = Option.getOrThrow(
    await Effect.runPromise(sealed.readPublic()),
  );

  return { client, wallet };
};

const usdcOf = async (client: ReturnType<typeof makeWalletClient>) => {
  const overview = await client.overview();

  assert.ok(
    overview instanceof Holding,
    `Expected Holding, got ${overview._tag}`,
  );

  return (
    overview.balances.find((balance) => sameAsset(balance.asset, baseAsset))
      ?.amount ?? 0n
  );
};

const sender = await newClient("sender");
const receiver = await newClient("receiver");

await fundWithUsdc(sender.wallet.address, "2");

const external = Keypair.random();
const externalAccount = await fundWithFriendbot(external.publicKey());

const trust = new TransactionBuilder(externalAccount, {
  fee: "10000",
  networkPassphrase,
})
  .addOperation(Operation.changeTrust({ asset: usdc }))
  .setTimeout(60)
  .build();

trust.sign(external);

await horizon.submitTransaction(trust);

const linkAmount = Schema.decodeSync(PositiveAmount)("5000000");

const createLink = async () => {
  const created = await fundLinkThroughReview(
    sender.client,
    new PaymentLinkIntent({
      asset: baseAsset,
      amount: linkAmount,
      saveOnDevice: false,
    }),
  );

  assert.ok(
    created instanceof PaymentLinkCreated,
    `Expected PaymentLinkCreated, got ${created._tag}`,
  );

  return created;
};

const accountExists = async (address: string) =>
  horizon
    .loadAccount(address)
    .then(() => true)
    .catch(() => false);

const gone = async (address: string) => {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!(await accountExists(address))) return true;
    await pause(2_000);
  }

  return false;
};

const history = async (address: string) => {
  const page = await horizon
    .transactions()
    .forAccount(address)
    .order("asc")
    .limit(20)
    .call();

  return Promise.all(
    page.records.map(async (record) => {
      const operations = await horizon
        .operations()
        .forTransaction(record.hash)
        .call();

      return {
        hash: record.hash,
        successful: record.successful,
        operations: operations.records.map((operation) => operation.type),
      };
    }),
  );
};

const walletLink = await createLink();
const externalLink = await createLink();

for (const link of [walletLink, externalLink])
  await fundWithFriendbot(link.address);

assert.ok(await accountExists(walletLink.address));

assert.ok(await accountExists(externalLink.address));

const receiverBefore = await usdcOf(receiver.client);
const reviewed = await receiver.client.reviewLinkReceive(walletLink.code);

assert.ok(
  reviewed instanceof LinkReceiveReview,
  `Expected LinkReceiveReview, got ${reviewed._tag}`,
);

const externalReviewed = await sender.client.reviewExternalLinkClaim(
  externalLink.code,
  new ExternalLinkIntent({
    destination: Schema.decodeSync(DestinationAddress)(external.publicKey()),
  }),
);

assert.ok(
  externalReviewed instanceof ExternalLinkReview,
  `Expected ExternalLinkReview, got ${externalReviewed._tag}`,
);

const [received, externalSettled] = await Promise.all([
  receiver.client.confirmLinkReceive(reviewed, walletLink.code),
  sender.client.confirmExternalLinkClaim(externalReviewed, externalLink.code),
]);

assert.ok(
  received instanceof AssetSettled,
  `Expected AssetSettled, got ${received._tag}`,
);

assert.ok(
  externalSettled instanceof ExternalLinkSettled,
  `Expected ExternalLinkSettled, got ${externalSettled._tag}`,
);

const receiverAfter = await usdcOf(receiver.client);

assert.equal(receiverAfter - receiverBefore, 5_000_000n);

const externalAfter = await horizon.loadAccount(external.publicKey());

const externalUsdc = externalAfter.balances.find(
  (line) =>
    line.asset_type !== "native" &&
    "asset_code" in line &&
    line.asset_code === usdc.code &&
    line.asset_issuer === usdc.issuer,
);

assert.equal(externalUsdc?.balance, "0.5000000");

const walletGone = await gone(walletLink.address);
const externalGone = await gone(externalLink.address);

assert.ok(walletGone, "wallet link account was not cleaned up");

assert.ok(externalGone, "external link account was not cleaned up");

console.log(
  JSON.stringify(
    {
      network: "testnet",
      reserveSponsor: sponsor.publicKey(),
      feePayer: feePayer.publicKey(),
      walletClaim: {
        link: walletLink.address,
        receiver: receiver.wallet.address,
        receiverGained: (receiverAfter - receiverBefore).toString(),
        linkAccountGone: walletGone,
        transactions: await history(walletLink.address),
      },
      externalClaim: {
        link: externalLink.address,
        destination: external.publicKey(),
        destinationUsdc: externalUsdc?.balance,
        linkAccountGone: externalGone,
        transactions: await history(externalLink.address),
      },
    },
    null,
    2,
  ),
);

await runtime.dispose();
