import {
  Account,
  Claimant,
  FeeBumpTransaction,
  Keypair,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  OpeningDraft,
  SigningRequest,
  type TransferOrder,
  UnclaimedFundsId,
  type WalletPort,
} from "../src/contract";
import {
  Applied,
  Chain,
  ChainUnreachable,
  type Sealed,
  Undecided,
} from "../src/server/Chain.server";
import { accountChain } from "../src/server/chain-accounts.server";
import { destinationChain } from "../src/server/chain-destinations.server";
import { draftChain } from "../src/server/chain-drafts.server";
import { linkChain } from "../src/server/chain-links.server";
import { PayoutPartner } from "../src/server/PayoutPartner.server";
import { Wallet } from "../src/server/Wallet.server";
import {
  draftClaimable,
  draftPaymentLink,
} from "../src/stellar/asset-envelopes";
import { draftPlan } from "../src/stellar/asset-plans";
import {
  draftOpening,
  draftPayment,
  signingPayload,
} from "../src/stellar/envelopes";
import {
  type KnownExchangeMemo,
  exchangeMemoFor,
} from "../src/stellar/exchange-memos.server";
import {
  type ClaimableBalance,
  unclaimedFundsEntry,
} from "../src/stellar/ledger-assets.server";
import type { AccountState } from "../src/stellar/ledger.server";
import { networkPassphrase } from "../src/stellar/network";
import { activityFlows } from "./activity-fixtures";
import {
  DeviceWallet,
  type MemoryKeyStore,
  enrolledDeviceWallet,
  memoryKeyStore,
  signingKey,
} from "./device-fixtures";
import { linkFlows } from "./link-fixtures";
import { ledgersHttp, resetLedgers } from "./rpc-events";
import {
  channel,
  feePayer,
  reserveSponsor,
  settingsFor,
  sponsor,
} from "./stellar-settings";
import {
  accountState,
  amount,
  dbLayer,
  holdingsReader,
  payoutCompletesAfter,
  resetWorld,
  walletScenarios,
  world,
} from "./wallet-scenarios";

export * from "./wallet-scenarios";

export { channel, feePayer, reserveSponsor };

export const exchangeMemos = new Array<KnownExchangeMemo>();

export const recordClaimableBalance = (balance: ClaimableBalance) =>
  world.claimables.set(balance.unclaimedFunds, unclaimedFundsEntry(balance));

const settings = settingsFor();

const realChain = Chain.layer.pipe(
  Layer.provide(settings),
  Layer.provide(ledgersHttp),
  Layer.provide(dbLayer),
);

const fakeChain = Layer.effect(
  Chain,
  Effect.gen(function* () {
    const real = yield* Chain;

    const rpcDown = () =>
      Effect.fail(new ChainUnreachable({ cause: new Error("RPC down") }));

    const account = (
      addr: AccountAddress,
    ): Effect.Effect<Option.Option<AccountState>, ChainUnreachable> =>
      world.ledgerDown
        ? rpcDown()
        : Effect.succeed(Option.fromNullishOr(world.accounts.get(addr)));

    const sourceOf = (addr: AccountAddress) =>
      new Account(addr, world.accounts.get(addr)?.sequence ?? "100");

    const draftWith = (
      build: (w: {
        readonly minTime: number;
        readonly maxTime: number;
      }) => SigningRequest["envelope"],
      offset = 0,
    ) =>
      Effect.map(Clock.currentTimeMillis, (ms) => {
        const minTime = Math.floor(ms / 1000) + offset;
        const maxTime = minTime + 120;

        return new SigningRequest({
          envelope: build({ minTime, maxTime }),
          expiresAt: DateTime.makeUnsafe(maxTime * 1000),
        });
      });

    const holdings = holdingsReader(account, reserveSponsor);

    const links = linkChain(
      sponsor,
      feePayer,
      account,
      () => Effect.sync(() => sourceOf(channel)),
      () => Effect.void,
    );

    return Chain.of({
      ...real,
      ...accountChain(account),
      ...destinationChain(holdings, (addr) =>
        world.ledgerDown
          ? rpcDown()
          : Effect.succeed(exchangeMemoFor(addr, exchangeMemos)),
      ),
      ...draftChain(account),
      ...links,
      holdings,
      unclaimedFunds: (ids) =>
        world.claimablesDown
          ? rpcDown()
          : Effect.succeed(
              ids.flatMap((id) => {
                const entry = world.claimables.get(id);

                return entry ? [entry] : [];
              }),
            ),
      issuer: (asset) =>
        Effect.succeed(
          Option.some(world.issuers.get(asset.id) ?? { authRequired: false }),
        ),
      draftAsset: (addr, plan) =>
        draftWith((w) =>
          draftPlan(plan, { source: sourceOf(addr), reserveSponsor, ...w }),
        ),
      draftClaimable: (from, to, a, val) =>
        draftWith((w) =>
          draftClaimable({
            source: sourceOf(from),
            reserveSponsor,
            to,
            asset: a,
            amount: val,
            ...w,
          }),
        ),
      draftPaymentLink: (from, to, a, val) =>
        draftWith((w) =>
          draftPaymentLink({
            source: sourceOf(from),
            reserveSponsor,
            to,
            asset: a,
            amount: val,
            ...w,
          }),
        ),
      cleanUpLink: (link) =>
        Effect.sync(
          () => !world.unmergeable.has(link) && !world.accounts.delete(link),
        ),
      pastOpeningWindow: (s) =>
        Effect.map(
          Clock.currentTimeMillis,
          (now) => DateTime.toEpochMillis(s.expiresAt) < now,
        ),
      draftOpening: (addr) =>
        draftWith((w) =>
          draftOpening({
            channel: sourceOf(channel),
            reserveSponsor,
            address: addr,
            createAccount: !world.accounts.has(addr),
            ...w,
          }),
        ).pipe(Effect.map((request) => new OpeningDraft({ request }))),
      draftPayment: (from, to, a, val, memo) =>
        draftWith((w) =>
          draftPayment({
            source: sourceOf(from),
            to,
            asset: a,
            amount: val,
            memo,
            ...w,
          }),
        ),
      submit: (sealed) =>
        Effect.gen(function* () {
          if (world.failSubmit) return yield* rpcDown();

          world.submitted.push(sealed);

          const outer = TransactionBuilder.fromXDR(
            sealed.envelope,
            networkPassphrase,
          );

          const inner =
            outer instanceof FeeBumpTransaction
              ? outer.innerTransaction
              : outer;

          const [first] = inner.operations;

          if (first?.type === "beginSponsoringFutureReserves") {
            const addr = Schema.decodeSync(AccountAddress)(first.sponsoredId);

            world.accounts.set(
              addr,
              accountState({
                sequence: world.accounts.get(addr)?.sequence ?? "1000",
                balance: Option.some(amount("0")),
              }),
            );
          }
        }),
      settlement: (s) =>
        Effect.succeed(world.evidence.get(s.hash) ?? new Undecided()),
    });
  }),
).pipe(Layer.provide(realChain));

const settleHash = (hash: string) =>
  world.evidence.set(hash, new Applied({ at: DateTime.nowUnsafe() }));

const settleTransfer = (
  order: TransferOrder,
  sealed: Sealed,
  sender: AccountAddress,
) => {
  settleHash(sealed.hash);

  const outer = TransactionBuilder.fromXDR(sealed.envelope, networkPassphrase);

  const inner =
    outer instanceof FeeBumpTransaction ? outer.innerTransaction : outer;

  if (
    inner.operations[1]?.type === "createClaimableBalance" &&
    Predicate.isTagged(order.to, "PaymentLink")
  )
    recordClaimableBalance({
      unclaimedFunds: Schema.decodeSync(UnclaimedFundsId)(
        inner.getClaimableBalanceId(1),
      ),
      asset: order.asset,
      amount: order.amount,
      sponsored: true,
      claimants: [
        new Claimant(order.to.value, Claimant.predicateUnconditional()),
        new Claimant(sender, Claimant.predicateUnconditional()),
      ],
    });
};

const scenarios = walletScenarios({
  randomKey: () => Keypair.random(),
  signingPayload,
  chain: fakeChain,
  settings,
  payoutPartner: PayoutPartner.sandbox(payoutCompletesAfter),
  settleHash,
  settleTransfer,
  reset: () => {
    resetWorld();
    exchangeMemos.length = 0;
    resetLedgers();
  },
});

export const {
  walletForDb,
  walletTestLayer,
  walletWithChain,
  approve,
  approveOpening,
  create,
  fundedWallet,
  authorizeTransfer,
  signedTransfer,
  settleOnSubmit,
  useDisposableDatabase,
} = scenarios;

export { settleHash };

export const { payUsername, receiveInto, claimExternally } =
  activityFlows(scenarios);

const links = linkFlows(scenarios);

export const openSender = Effect.fn(function* (
  store: MemoryKeyStore,
  name = "maria",
) {
  const sender = new DeviceWallet({
    ...enrolledDeviceWallet(name),
    reserveSponsor,
  });

  yield* create(signingKey(sender.phrase), name);
  yield* store.seed(sender);
  world.accounts.set(sender.address, accountState());

  return { wallet: yield* Wallet, sender };
});

export const fundLinkFrom = (wallet: WalletPort, sender: DeviceWallet) =>
  links
    .fundLinkFrom(wallet, signingKey(sender.phrase))
    .pipe(
      Effect.tap(() =>
        Effect.sync(() => world.accounts.set(channel, accountState())),
      ),
    );

export const fundLink = (username: string) =>
  Effect.gen(function* () {
    const { wallet, sender } = yield* openSender(memoryKeyStore(), username);

    return { wallet, sender, ...(yield* fundLinkFrom(wallet, sender)) };
  });
