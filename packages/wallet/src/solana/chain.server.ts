import { Database } from "@workspace/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import { AccountAddress, type Asset, baseAsset, sameAsset } from "../contract";
import { Chain } from "../server/Chain.server";
import {
  validateRpcTimeout,
  validateRpcUrl,
} from "../server/rpc-settings.server";
import { WalletSettings } from "../server/settings.server";
import { solanaAccountChain } from "./account-chain.server";
import { solanaAddressRules } from "./address-rules";
import { solanaDepositChain } from "./deposit-chain.server";
import { solanaDestinationChain } from "./destination-chain.server";
import { solanaDraftChain } from "./draft-chain.server";
import { solanaHoldings } from "./holdings.server";
import { solanaRpc } from "./rpc.server";
import { solanaSeal, solanaSponsor } from "./seal.server";
import { sponsorKeypairOf } from "./sponsor-keys.server";
import { sponsoredFailuresIn } from "./sponsored-failures.server";
import { solanaSubmission } from "./submission.server";
import { solanaUnclaimedFunds } from "./unclaimed-funds.server";

const isUsdc = (asset: Asset) => sameAsset(asset, baseAsset);

export const solanaChainLayer = Layer.effect(
  Chain,
  Effect.gen(function* () {
    const settings = yield* WalletSettings;
    const rpcUrl = yield* validateRpcUrl(settings.rpcUrl);
    const rpcTimeout = yield* validateRpcTimeout(settings.rpcTimeout);
    const rpc = solanaRpc(yield* HttpClient.HttpClient, rpcUrl, rpcTimeout);
    const sponsor = solanaSponsor(sponsorKeypairOf(settings.sponsorSecret));
    const sponsorAddress = Schema.decodeSync(AccountAddress)(sponsor.address);
    const holdings = solanaHoldings(rpc, sponsorAddress);
    const drafts = solanaDraftChain(rpc, sponsor.address);

    const { unclaimedFunds, unclaimedFundsClosedAt } = solanaUnclaimedFunds(
      rpc,
      sponsorAddress,
    );

    return Chain.of({
      ...solanaAccountChain(rpc, sponsorAddress),
      ...holdings,
      ...solanaDestinationChain(holdings),
      ...solanaDepositChain(rpc),
      ...drafts,
      ...solanaSubmission(rpc, sponsoredFailuresIn(yield* Database)),
      validAsset: isUsdc,
      issuedBy: () => false,
      issuer: (asset) =>
        Effect.succeed(
          isUsdc(asset) ? Option.some({ authRequired: false }) : Option.none(),
        ),
      unclaimedFunds,
      unclaimedFundsClosedAt,
      draftClaimable: () =>
        Effect.die(
          new RangeError("A Solana transfer never waits as a claimable"),
        ),
      validAddress: solanaAddressRules.hasValidChecksum,
      seal: solanaSeal(sponsor),
    });
  }),
);
