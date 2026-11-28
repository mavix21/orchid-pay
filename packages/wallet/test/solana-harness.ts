import { ed25519 } from "@noble/curves/ed25519.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import { address } from "@solana/kit";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  PositiveAmount,
  UnclaimedFundsId,
  type UnsignedEnvelope,
  type WalletPort,
  baseAsset,
} from "../src/contract";
import { Applied, Chain, ChainUnreachable } from "../src/server/Chain.server";
import { PayoutPartner } from "../src/server/PayoutPartner.server";
import { WalletSettings } from "../src/server/settings.server";
import type { UnclaimedFundsEntry } from "../src/server/unclaimed-funds.server";
import { Wallet } from "../src/server/Wallet.server";
import { solanaDestinationChain } from "../src/solana/destination-chain.server";
import { solanaDraftChain } from "../src/solana/draft-chain.server";
import { EnvelopeFacts, readEnvelope } from "../src/solana/envelopes";
import type { SolanaRpc } from "../src/solana/rpc.server";
import { solanaSeal, solanaSponsor } from "../src/solana/seal.server";
import { solanaSigningScheme } from "../src/solana/signing-scheme";
import { activityFlows } from "./activity-fixtures";
import {
  DeviceWallet,
  type MemoryKeyStore,
  enrolledDeviceWallet,
  memoryKeyStore,
  signingKey,
} from "./device-fixtures";
import { linkFlows } from "./link-fixtures";
import { memoryChain } from "./memory-chain";
import { randomKey } from "./test-keys";
import {
  accountState,
  amount,
  passkeyOrigin,
  payoutCompletesAfter,
  resetWorld,
  walletScenarios,
  world,
} from "./wallet-scenarios";

export * from "./wallet-scenarios";

export const sponsorSeed = ed25519.utils.randomSecretKey();

const sponsorKeypair = concatBytes(
  sponsorSeed,
  ed25519.getPublicKey(sponsorSeed),
);

const sponsor = solanaSponsor(sponsorKeypair);

export const reserveSponsor = Schema.decodeSync(AccountAddress)(
  sponsor.address,
);

const blockhashWindow = { slot: 100, height: 0 };

export const passBlockhashWindows = () => {
  blockhashWindow.height = blockhashWindow.slot + 1_000;
};

const rpcReply = (method: string) => {
  if (method === "getLatestBlockhash") {
    blockhashWindow.slot += 1;

    return {
      context: { slot: blockhashWindow.slot },
      value: {
        blockhash: "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N",
        lastValidBlockHeight: blockhashWindow.height + 150,
      },
    };
  }

  if (method === "getBlockHeight") return blockhashWindow.height;

  return [];
};

const call: SolanaRpc["call"] = (method, _params, result) =>
  world.ledgerDown
    ? Effect.fail(new ChainUnreachable({ cause: new Error("RPC down") }))
    : Schema.decodeUnknownEffect(result)(rpcReply(method)).pipe(Effect.orDie);

const rpc: SolanaRpc = { call, attempt: call };

const sealedRequests = new Map<string, UnsignedEnvelope>();

const factsOf = (hash: string) =>
  Option.flatMap(Option.fromUndefinedOr(sealedRequests.get(hash)), (envelope) =>
    readEnvelope(envelope, sponsor.address),
  );

export const recordUnclaimedFunds = (held: {
  readonly unclaimedFunds: UnclaimedFundsId;
  readonly link: AccountAddress;
  readonly sender: AccountAddress;
  readonly amount: PositiveAmount;
}) =>
  world.claimables.set(held.unclaimedFunds, {
    unclaimedFunds: held.unclaimedFunds,
    asset: baseAsset,
    amount: held.amount,
    claimOf: (account) =>
      account === held.link || account === held.sender
        ? Option.some({ opensAt: Option.none(), claimableAt: () => true })
        : Option.none(),
    paymentLinkFrom: (sender) =>
      sender === held.sender ? Option.some(held.link) : Option.none(),
  });

const unclaimedFundsEntry = (
  facts: Extract<EnvelopeFacts, { readonly _tag: "PaymentLinkFacts" }>,
): UnclaimedFundsEntry => ({
  unclaimedFunds: Schema.decodeSync(UnclaimedFundsId)(facts.unclaimedFunds),
  asset: baseAsset,
  amount: Schema.decodeSync(PositiveAmount)(facts.amount.toString()),
  claimOf: (account) =>
    address(account) === facts.link || address(account) === facts.from
      ? Option.some({ opensAt: Option.none(), claimableAt: () => true })
      : Option.none(),
  paymentLinkFrom: (sender) =>
    address(sender) === facts.from
      ? Option.some(Schema.decodeSync(AccountAddress)(facts.link))
      : Option.none(),
});

export const settleHash = (hash: string) => {
  world.evidence.set(hash, new Applied({ at: DateTime.nowUnsafe() }));

  Option.map(
    factsOf(hash),
    EnvelopeFacts.$match({
      OpeningFacts: () => {},
      PaymentFacts: () => {},
      PaymentLinkFacts: (facts) => {
        world.claimables.set(facts.unclaimedFunds, unclaimedFundsEntry(facts));
      },
      LinkReceiveFacts: ({ unclaimedFunds }) => {
        world.claimables.delete(unclaimedFunds);
      },
      ReclaimFacts: ({ unclaimedFunds }) => {
        world.claimables.delete(unclaimedFunds);
      },
    }),
  );
};

const settings = Layer.succeed(WalletSettings, {
  rpcUrl: "https://devnet.solana.test",
  sponsorSecret: Redacted.make(base58.encode(sponsorKeypair)),
  passkeyOrigins: [passkeyOrigin],
  humanCheckSecret: Redacted.make("human-check-secret"),
  sessionSecret: Redacted.make("session-secret"),
});

const solanaChain = Layer.effect(
  Chain,
  Effect.gen(function* () {
    const memory = yield* Chain;
    const drafts = solanaDraftChain(rpc, sponsor.address);
    const seal = solanaSeal(sponsor);

    return Chain.of({
      ...memory,
      ...drafts,
      ...solanaDestinationChain(memory),
      standing: (owner) =>
        memory
          .standing(owner)
          .pipe(
            Effect.map((standing) =>
              world.accounts.get(owner)?.sponsored === false
                ? "foreignIncomplete"
                : standing,
            ),
          ),
      validAsset: (asset) => asset.id === baseAsset.id,
      pastOpeningWindow: memory.pastOpeningWindow,
      seal: (request, approval, holder) =>
        seal(request, approval, holder).pipe(
          Effect.tap((sealed) =>
            Effect.sync(() =>
              sealedRequests.set(sealed.hash, request.envelope),
            ),
          ),
        ),
      submit: (sealed) =>
        Effect.suspend(() => {
          if (world.failSubmit)
            return Effect.fail(
              new ChainUnreachable({ cause: new Error("RPC down") }),
            );

          world.submitted.push(sealed);

          Option.map(factsOf(sealed.hash), (facts) => {
            if (EnvelopeFacts.$is("OpeningFacts")(facts))
              world.accounts.set(
                Schema.decodeSync(AccountAddress)(facts.address),
                accountState({ balance: Option.some(amount("0")) }),
              );
          });

          return Effect.void;
        }),
    });
  }),
).pipe(Layer.provide(memoryChain));

const scenarios = walletScenarios({
  randomKey,
  signingPayload: solanaSigningScheme.signingPayload,
  chain: solanaChain,
  settings,
  payoutPartner: PayoutPartner.sandbox(payoutCompletesAfter),
  settleHash,
  settleTransfer: (_order, sealed) => settleHash(sealed.hash),
  reset: () => {
    resetWorld();
    sealedRequests.clear();
    blockhashWindow.height = 0;
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
  settleSubmitted,
  useDisposableDatabase,
} = scenarios;

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
  links.fundLinkFrom(wallet, signingKey(sender.phrase));

export const fundLink = (username: string) =>
  Effect.gen(function* () {
    const { wallet, sender } = yield* openSender(memoryKeyStore(), username);

    return { wallet, sender, ...(yield* fundLinkFrom(wallet, sender)) };
  });
