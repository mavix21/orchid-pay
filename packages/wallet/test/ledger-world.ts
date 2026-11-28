import type * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  Amount,
  type Asset,
  type AssetId,
  HumanCheckRefused,
  baseAsset,
  sameAsset,
} from "../src/contract";
import type { Sealed, Settlement } from "../src/server/Chain.server";
import type { ChainDeposit } from "../src/server/chain-deposits.server";
import type { Holdings } from "../src/server/holdings.server";
import { HumanCheck } from "../src/server/HumanCheck.server";
import type { UnclaimedFundsEntry } from "../src/server/unclaimed-funds.server";
import {
  type PendingWork,
  QueueUnavailable,
  WorkQueue,
} from "../src/server/work-queue.server";

export const passkeyOrigin = "http://localhost:3000";

export interface LedgerAccount {
  readonly sequence: string;
  readonly ledger: number;
  readonly accountSponsored: boolean;
  readonly sponsored: boolean;
  readonly untouched: boolean;
  readonly nativeBalance: bigint;
  readonly balance: Option.Option<Amount>;
}

export const world = {
  humanCheckRefused: false,
  accounts: new Map<AccountAddress, LedgerAccount>(),
  evidence: new Map<string, Settlement>(),
  submitted: new Array<Sealed>(),
  queued: new Array<PendingWork>(),
  queueDown: false,
  unmergeable: new Set<AccountAddress>(),
  failSubmit: false,
  ledgerDown: false,
  unreadable: new Set<string>(),
  claimablesDown: false,
  holdings: new Map<AccountAddress, Holdings>(),
  claimables: new Map<string, UnclaimedFundsEntry>(),
  closures: new Map<string, DateTime.Utc>(),
  deposits: new Map<AccountAddress, Array<ChainDeposit>>(),
  unreadableDeposits: new Set<string>(),
  issuers: new Map<AssetId, { readonly authRequired: boolean }>(),
};

export const resetWorld = () => {
  world.accounts.clear();
  world.holdings.clear();
  world.claimables.clear();
  world.closures.clear();
  world.deposits.clear();
  world.unreadableDeposits.clear();
  world.issuers.clear();
  world.evidence.clear();
  world.submitted.length = 0;
  world.queued.length = 0;
  world.queueDown = false;
  world.unmergeable.clear();
  world.failSubmit = false;
  world.humanCheckRefused = false;
  world.ledgerDown = false;
  world.unreadable.clear();
  world.claimablesDown = false;
};

export const recordingQueue = Layer.succeed(WorkQueue, {
  send: (work) =>
    world.queueDown
      ? Effect.fail(new QueueUnavailable({ cause: new Error("Queue down") }))
      : Effect.sync(() => {
          world.queued.push(work);
        }),
});

export const fakeHumanCheck = Layer.succeed(
  HumanCheck,
  HumanCheck.of({
    verify: () =>
      Effect.succeed(
        world.humanCheckRefused
          ? Option.some(new HumanCheckRefused())
          : Option.none(),
      ),
  }),
);

export const amount = (value: string) => Schema.decodeSync(Amount)(value);

export const accountState = (
  overrides: Partial<LedgerAccount> = {},
): LedgerAccount => ({
  sequence: "1000",
  ledger: 100,
  accountSponsored: true,
  sponsored: true,
  untouched: true,
  nativeBalance: 0n,
  balance: Option.some(amount("50000000")),
  ...overrides,
});

export const holdingsFor = (
  address: AccountAddress,
  overrides: Partial<Holdings> = {},
): Holdings => ({
  nativeTotal: amount(
    (world.accounts.get(address) ?? accountState()).nativeBalance.toString(),
  ),
  reserveSponsor: Option.none(),
  native: amount("0"),
  lines: [],
  ...overrides,
});

export const advanceSequence = (address: AccountAddress) => {
  const current = world.accounts.get(address) ?? accountState();

  world.accounts.set(address, {
    ...current,
    sequence: (BigInt(current.sequence) + 1n).toString(),
  });
};

export const holdingsReader =
  <E>(
    account: (
      address: AccountAddress,
    ) => Effect.Effect<Option.Option<LedgerAccount>, E>,
    reserveSponsor: AccountAddress,
  ) =>
  (address: AccountAddress, assets: ReadonlyArray<Asset>) =>
    world.holdings.has(address)
      ? Effect.succeed(Option.fromNullishOr(world.holdings.get(address)))
      : account(address).pipe(
          Effect.map(
            Option.map((state) =>
              holdingsFor(address, {
                nativeTotal: amount(state.nativeBalance.toString()),
                reserveSponsor: state.accountSponsored
                  ? Option.some(reserveSponsor)
                  : Option.none(),
                native: amount(state.nativeBalance.toString()),
                lines: assets.flatMap((asset) =>
                  sameAsset(asset, baseAsset) && Option.isSome(state.balance)
                    ? [
                        {
                          asset,
                          balance: state.balance.value,
                          spendable: state.balance.value,
                          capacity: amount("9223372036854775807"),
                          authorized: true,
                          clawbackEnabled: false,
                          sponsored: true,
                        },
                      ]
                    : [],
                ),
              }),
            ),
          ),
        );
