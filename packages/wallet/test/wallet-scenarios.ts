import { beforeEach, expect } from "@effect/vitest";
import { Database } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  AddressRecipient,
  type ActivityPage,
  Approval,
  type Approvals,
  AssetOrder,
  AssetOrderId,
  type CheckedRecipient,
  type HumanCheckRefused,
  type OpeningDraft,
  PositiveAmount,
  type Recipient,
  type SigningRequest,
  TransferId,
  TransferIntent,
  TransferOrder,
  type UnsignedEnvelope,
  Username,
  WalletClaim,
  type WalletPort,
  baseAsset,
} from "../src/contract";
import { AssetOrders } from "../src/server/AssetOrders.server";
import { Backups } from "../src/server/Backups.server";
import { Applied, Chain, type Sealed } from "../src/server/Chain.server";
import { Deposits } from "../src/server/Deposits.server";
import { Directory } from "../src/server/Directory.server";
import type { PayoutPartner } from "../src/server/PayoutPartner.server";
import { RateLimits } from "../src/server/RateLimits.server";
import type { WalletSettings } from "../src/server/settings.server";
import { transfers } from "../src/server/tables.server";
import { Transfers } from "../src/server/Transfers.server";
import { checkedBinding } from "../src/server/username-standing.server";
import type { PendingWork } from "../src/server/work-queue.server";
import { Wallet } from "../src/server/Wallet.server";
import { SoftwareAuthenticator } from "./software-authenticator";
import {
  accountState,
  fakeHumanCheck,
  passkeyOrigin,
  recordingQueue,
  type LedgerAccount,
  world,
} from "./ledger-world";
import { assertTagged } from "./tagged";
import { type TestKey, addressOf } from "./test-keys";
import { dbLayer, useMigratedDatabase } from "./test-database";

export { addressOf, dbLayer, passkeyOrigin };

export {
  type LedgerAccount,
  accountState,
  advanceSequence,
  amount,
  fakeHumanCheck,
  holdingsFor,
  holdingsReader,
  recordingQueue,
  resetWorld,
  world,
} from "./ledger-world";

export { euro, euroLine } from "./euro-fixtures";

const storesFor = <E>(db: Layer.Layer<Database, E>) =>
  Layer.mergeAll(
    Directory.layer,
    Transfers.layer,
    AssetOrders.layer,
    Backups.layer,
    Deposits.layer,
  ).pipe(Layer.provide(db), Layer.provide(recordingQueue));

export const stores = storesFor(dbLayer);

export const bindingAllowed = checkedBinding(
  Effect.succeed(Option.none<HumanCheckRefused>()),
);

export const payoutCompletesAfter = Duration.minutes(1);

export const linkAmount = Schema.decodeSync(PositiveAmount)("10000000");

export const claimFor = (key: TestKey, name: string) =>
  new WalletClaim({
    address: addressOf(key),
    username: Schema.decodeSync(Username)(name),
  });

export const opening = (
  claim: WalletClaim,
  approvals: Option.Option<Approvals> = Option.none(),
) => Wallet.use((w) => w.open(claim, approvals));

export const overviewOf = (addr: AccountAddress) =>
  Wallet.use((w) => w.overview(addr));

export const sweepNow = Wallet.use((w) => w.sweep);

export const attend = (work: PendingWork, attempt = 1) =>
  Wallet.use((w) => w.attend(work, attempt));

export const ageSignedWork = Database.use((db) =>
  Effect.all([
    db.execute(
      sql`update transfers set "expiresAt" = "expiresAt" - interval '1 hour' where status = 'authorized'`,
    ),
    db.execute(
      sql`update asset_orders set "expiresAt" = "expiresAt" - interval '1 hour' where status = 'authorized'`,
    ),
    db.execute(
      sql`update asset_orders set "concludedAt" = "concludedAt" - interval '1 hour' where status = 'settled' and "linkCleanedAt" is null`,
    ),
  ]),
);

export const sweep = ageSignedWork.pipe(Effect.andThen(sweepNow));

export const authorizedTransfers = Database.use((db) =>
  db
    .select({ id: transfers.id, envelope: transfers.envelope })
    .from(transfers)
    .where(eq(transfers.status, "authorized")),
);

export const findWallet = (addr: AccountAddress) =>
  Directory.use((d) => d.byAddress(addr));

export const findTransfer = (id: TransferId) =>
  Transfers.use((t) => t.find(id));

export const settleAttempt = Effect.fn(function* (
  address: AccountAddress,
  settledSecondsAgo = 0,
) {
  const row = Option.getOrThrow(yield* findWallet(address));

  world.evidence.set(
    Option.getOrThrow(Option.fromNullishOr(row.attemptHash)),
    new Applied({
      at: DateTime.makeUnsafe(Date.now() - settledSecondsAgo * 1000),
    }),
  );
});

export const expireAttempt = (address: AccountAddress) =>
  Database.use((db) =>
    db.execute(
      sql`update wallets set "attemptExpiresAt" = now() - interval '1 hour' where address = ${address}`,
    ),
  );

export const fundHolder = (
  key: TestKey,
  overrides: Partial<LedgerAccount> = {},
) => world.accounts.set(addressOf(key), accountState(overrides));

export const orderFor = (sender: TestKey, to: Recipient) =>
  new TransferOrder({
    asset: baseAsset,
    id: Schema.decodeSync(TransferId)(crypto.randomUUID()),
    from: addressOf(sender),
    to,
    amount: Schema.decodeSync(PositiveAmount)("10000000"),
  });

export const selfOrder = (sender: TestKey) =>
  orderFor(sender, AddressRecipient.make({ value: addressOf(sender) }));

export const send = (
  order: TransferOrder,
  approval: Option.Option<Approval> = Option.none(),
) => Wallet.use((w) => w.transfer(order, approval));

export const checkRecipient = (to: CheckedRecipient) =>
  Wallet.use((w) => w.checkRecipient(to));

export const assess = (sender: TestKey, order: TransferOrder) =>
  Wallet.use((w) =>
    w.assess(
      addressOf(sender),
      new TransferIntent({
        to: order.to,
        asset: order.asset,
        amount: order.amount,
        memo: order.memo,
      }),
    ),
  );

export const storedTransfers = (address: AccountAddress) =>
  Database.use((db) =>
    db
      .select({ id: transfers.id })
      .from(transfers)
      .where(eq(transfers.sender, address)),
  );

export const draftTransfer = Effect.fn(function* (order: TransferOrder) {
  const draft = yield* send(order);

  assertTagged(draft, "TransferDraft");

  return draft;
});

export const assetOrderId = () =>
  Schema.decodeSync(AssetOrderId)(crypto.randomUUID());

export const manage = (
  order: AssetOrder,
  approval: Option.Option<Approval> = Option.none(),
) => Wallet.use((w) => w.manage(order, approval));

export const assetOrder = (key: TestKey, action: AssetOrder["action"]) =>
  new AssetOrder({
    id: assetOrderId(),
    wallet: addressOf(key),
    action,
  });

export const username = (name: string) => Schema.decodeSync(Username)(name);

export const activityOf = Effect.fn(function* (
  wallet: WalletPort,
  address: AccountAddress,
) {
  const page = yield* wallet.activity(address);

  assertTagged(page, "ActivityPage");

  return page;
});

export const entryFor = (page: ActivityPage, id: string) => {
  const found = page.entries.find((entry) => entry.id === id);

  if (!found) throw new Error(`Expected an entry for ${id}`);

  return found;
};

export const devicePasskeys = new SoftwareAuthenticator(passkeyOrigin).passkeys;

interface TestNetwork<Key extends TestKey, ChainFailure> {
  readonly randomKey: () => Key;
  readonly signingPayload: (envelope: UnsignedEnvelope) => Uint8Array;
  readonly chain: Layer.Layer<Chain, ChainFailure>;
  readonly settings: Layer.Layer<WalletSettings>;
  readonly payoutPartner: Layer.Layer<PayoutPartner, never, WalletSettings>;
  readonly settleHash: (hash: string) => void;
  readonly settleTransfer: (
    order: TransferOrder,
    sealed: Sealed,
    sender: AccountAddress,
  ) => void;
  readonly reset: () => void;
}

export const walletScenarios = <Key extends TestKey, ChainFailure>(
  network: TestNetwork<Key, ChainFailure>,
) => {
  const { settleHash } = network;

  const walletForDb = <E>(
    db: Layer.Layer<Database, E>,
    limits: Layer.Layer<RateLimits> = RateLimits.unlimited,
  ) =>
    Wallet.serviceLayer.pipe(
      Layer.provide(storesFor(db)),
      Layer.provide(recordingQueue),
      Layer.provide(limits),
      Layer.provide(network.chain),
      Layer.provide(fakeHumanCheck),
      Layer.provide(network.payoutPartner),
      Layer.provide(network.settings),
    );

  const walletTestLayer = Layer.mergeAll(walletForDb(dbLayer), stores, dbLayer);

  const walletWithChain = (
    override: (a: Chain["Service"]) => Partial<Chain["Service"]>,
  ) =>
    Layer.fresh(
      Wallet.serviceLayer.pipe(
        Layer.provide(stores),
        Layer.provide(recordingQueue),
        Layer.provide(RateLimits.unlimited),
        Layer.provide(
          Layer.effect(
            Chain,
            Effect.map(Chain, (a) => Chain.of({ ...a, ...override(a) })),
          ).pipe(Layer.provide(network.chain)),
        ),
        Layer.provide(fakeHumanCheck),
        Layer.provide(network.payoutPartner),
        Layer.provide(network.settings),
      ),
    );

  const signatureOf = (request: SigningRequest, key: TestKey) =>
    new Approval({
      signature: key.sign(network.signingPayload(request.envelope)),
    });

  const approve = (request: SigningRequest, key: TestKey) =>
    Option.some(signatureOf(request, key));

  const approveOpening = (
    key: TestKey,
    draft: OpeningDraft,
  ): Option.Option<Approvals> => Option.some([signatureOf(draft.request, key)]);

  const sealLostOpening = Effect.fn(function* (
    key: TestKey,
    claim: WalletClaim,
  ) {
    const draft = yield* opening(claim);

    assertTagged(draft, "OpeningDraft");
    world.failSubmit = true;
    assertTagged(
      yield* opening(claim, approveOpening(key, draft)),
      "OpeningPending",
    );
    world.failSubmit = false;

    return Option.getOrThrow(
      Option.fromNullishOr(
        Option.getOrThrow(yield* findWallet(claim.address)).attemptHash,
      ),
    );
  });

  const create = Effect.fn(function* (key: TestKey, name: string) {
    const claim = claimFor(key, name);
    const draft = yield* opening(claim);

    assertTagged(draft, "OpeningDraft");
    expect((yield* opening(claim, approveOpening(key, draft)))._tag).toBe(
      "OpeningPending",
    );
    yield* settleAttempt(claim.address);
    expect((yield* opening(claim))._tag).toBe("Opened");

    return claim;
  });

  const fundedWallet = Effect.fn(function* (
    name = "maria",
    overrides?: Partial<LedgerAccount>,
  ) {
    const key = network.randomKey();

    yield* create(key, name);
    fundHolder(key, overrides);

    return key;
  });

  const authorizeTransfer = Effect.fn(function* (
    sender: TestKey,
    order: TransferOrder,
    options: { readonly failSubmit?: boolean } = {},
  ) {
    const draft = yield* draftTransfer(order);

    world.failSubmit = options.failSubmit ?? false;
    yield* send(order, approve(draft.request, sender));
    world.failSubmit = false;

    const stored = Option.getOrThrow(yield* findTransfer(order.id));

    assertTagged(stored, "Authorized");

    return { draft, authorized: stored };
  });

  const signedTransfer = Effect.fn(function* (name: string) {
    const key = yield* fundedWallet(name);
    const order = selfOrder(key);

    const { authorized } = yield* authorizeTransfer(key, order, {
      failSubmit: true,
    });

    return {
      order,
      hash: authorized.sealed.hash,
      envelope: authorized.sealed.envelope,
    };
  });

  const settleSubmitted = (unclaimedFunds?: string) =>
    Effect.sync(() => {
      settleHash(
        Option.getOrThrow(Option.fromNullishOr(world.submitted.at(-1))).hash,
      );

      if (unclaimedFunds) world.claimables.delete(unclaimedFunds);
    });

  const settleOnSubmit =
    (wallet: WalletPort, sender: AccountAddress): WalletPort["transfer"] =>
    (order, approval) =>
      wallet.transfer(order, approval).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            const sealed = world.submitted.at(-1);

            if (Option.isSome(approval) && sealed)
              network.settleTransfer(order, sealed, sender);
          }),
        ),
      );

  return {
    randomKey: network.randomKey,
    walletForDb,
    walletTestLayer,
    walletWithChain,
    approve,
    approveOpening,
    sealLostOpening,
    create,
    fundedWallet,
    authorizeTransfer,
    signedTransfer,
    settleHash,
    settleSubmitted,
    settleOnSubmit,
    useDisposableDatabase: () => {
      useMigratedDatabase();
      beforeEach(network.reset);
    },
  };
};
