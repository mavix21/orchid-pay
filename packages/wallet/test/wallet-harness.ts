import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { PayoutPartner } from "../src/server/PayoutPartner.server";
import { WalletSettings } from "../src/server/settings.server";
import { Wallet } from "../src/server/Wallet.server";
import { activityFlows } from "./activity-fixtures";
import { linkFlows } from "./link-fixtures";
import {
  memoryChain,
  memorySigningPayload,
  resetMemoryChain,
  settleDraft,
} from "./memory-chain";
import { randomAddress, randomKey } from "./test-keys";
import {
  passkeyOrigin,
  payoutCompletesAfter,
  resetWorld,
  walletScenarios,
} from "./wallet-scenarios";

export * from "./wallet-scenarios";

export { draftedReceive, exchanges, memoryChain } from "./memory-chain";

export const partnerAddress = randomAddress();

const settings = Layer.succeed(WalletSettings, {
  rpcUrl: "https://ledger.memory.test",
  sponsorSecret: Redacted.make("unused-sponsor"),
  passkeyOrigins: [passkeyOrigin],
  humanCheckSecret: Redacted.make("human-check-secret"),
  sessionSecret: Redacted.make("session-secret"),
});

const scenarios = walletScenarios({
  randomKey,
  signingPayload: memorySigningPayload,
  chain: memoryChain,
  settings,
  payoutPartner: PayoutPartner.depositingTo(
    partnerAddress,
    payoutCompletesAfter,
  ),
  settleHash: settleDraft,
  settleTransfer: (_order, sealed) => settleDraft(sealed.hash),
  reset: () => {
    resetWorld();
    resetMemoryChain();
  },
});

export const {
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
  useDisposableDatabase,
} = scenarios;

export const {
  payUsername,
  receiveInto,
  claimBalance,
  claimExternally,
  payWithoutTrustline,
} = activityFlows(scenarios);

export const { fundLinkFrom } = linkFlows(scenarios);

export const fundLink = (username: string) =>
  Effect.gen(function* () {
    const sender = yield* scenarios.fundedWallet(username);
    const wallet = yield* Wallet;

    return { wallet, sender, ...(yield* fundLinkFrom(wallet, sender)) };
  });
