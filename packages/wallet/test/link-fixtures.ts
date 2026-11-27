import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  PaymentLinkRecipient,
  TransferId,
  TransferOrder,
  type WalletPort,
  baseAsset,
} from "../src/contract";
import { assertTagged } from "./tagged";
import type { TestKey } from "./test-keys";
import {
  type walletScenarios,
  addressOf,
  advanceSequence,
  euroLine,
  holdingsFor,
  linkAmount,
  world,
} from "./wallet-scenarios";

export const linkFlows = <Key extends TestKey, ChainFailure>({
  randomKey,
  approve,
  settleOnSubmit,
}: ReturnType<typeof walletScenarios<Key, ChainFailure>>) => ({
  fundLinkFrom: (wallet: WalletPort, sender: TestKey) =>
    Effect.gen(function* () {
      const address = addressOf(sender);

      world.holdings.set(
        address,
        holdingsFor(address, {
          lines: [{ ...euroLine("500000000"), asset: baseAsset }],
        }),
      );

      const link = randomKey();

      const funding = new TransferOrder({
        id: Schema.decodeSync(TransferId)(crypto.randomUUID()),
        from: address,
        to: PaymentLinkRecipient.make({ value: addressOf(link) }),
        asset: baseAsset,
        amount: linkAmount,
      });

      const fundingDraft = yield* wallet.transfer(funding, Option.none());

      assertTagged(fundingDraft, "TransferDraft");
      yield* settleOnSubmit(wallet, address)(
        funding,
        approve(fundingDraft.request, sender),
      );

      const funded = yield* wallet.transfer(funding, Option.none());

      assertTagged(funded, "Settled");

      const unclaimedFunds = Option.getOrThrow(
        Option.fromNullishOr(funded.unclaimedFunds),
      );

      advanceSequence(address);

      return { link, unclaimedFunds, transferId: funding.id };
    }),
});
