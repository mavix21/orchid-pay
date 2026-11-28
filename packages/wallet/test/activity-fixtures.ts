import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  AssetOrder,
  ClaimUnclaimedFunds,
  type DestinationAddress,
  ExternalLinkOrder,
  ReceiveLink,
  type UnclaimedFundsId,
  UsernameRecipient,
  type WalletPort,
} from "../src/contract";
import { assertTagged } from "./tagged";
import type { TestKey } from "./test-keys";
import {
  type walletScenarios,
  accountState,
  addressOf,
  advanceSequence,
  assetOrderId,
  draftTransfer,
  orderFor,
  send,
  username,
  world,
} from "./wallet-scenarios";

interface FundedLink {
  readonly link: TestKey;
  readonly unclaimedFunds: UnclaimedFundsId;
}

export const activityFlows = <Key extends TestKey, ChainFailure>({
  approve,
  settleSubmitted,
}: ReturnType<typeof walletScenarios<Key, ChainFailure>>) => {
  const payUsername = Effect.fn(function* (
    sender: TestKey,
    recipient: string,
    order = orderFor(
      sender,
      UsernameRecipient.make({ value: username(recipient) }),
    ),
  ) {
    const draft = yield* draftTransfer(order);

    assertTagged(yield* send(order, approve(draft.request, sender)), "Pending");
    yield* settleSubmitted();

    const settled = yield* send(order);

    assertTagged(settled, "Settled");
    advanceSequence(order.from);

    return { order, settled };
  });

  const receiveInto = Effect.fn(function* (
    wallet: WalletPort,
    claimer: TestKey,
    funded: FundedLink,
  ) {
    const order = new AssetOrder({
      id: assetOrderId(),
      wallet: addressOf(claimer),
      action: ReceiveLink.make({
        link: addressOf(funded.link),
        unclaimedFunds: funded.unclaimedFunds,
      }),
    });

    const draft = yield* wallet.manage(order, Option.none());

    assertTagged(draft, "AssetDraft");
    assertTagged(
      yield* wallet.manage(order, approve(draft.request, funded.link)),
      "AssetPending",
    );
    yield* settleSubmitted(funded.unclaimedFunds);
    assertTagged(yield* wallet.manage(order, Option.none()), "AssetSettled");

    return order;
  });

  const claimBalance = Effect.fn(function* (
    wallet: WalletPort,
    owner: TestKey,
    unclaimedFunds: UnclaimedFundsId,
  ) {
    const order = new AssetOrder({
      id: assetOrderId(),
      wallet: addressOf(owner),
      action: ClaimUnclaimedFunds.make({ unclaimedFunds }),
    });

    const draft = yield* wallet.manage(order, Option.none());

    assertTagged(draft, "AssetDraft");
    assertTagged(
      yield* wallet.manage(order, approve(draft.request, owner)),
      "AssetPending",
    );
    yield* settleSubmitted(unclaimedFunds);
    assertTagged(yield* wallet.manage(order, Option.none()), "AssetSettled");
  });

  const claimExternally = Effect.fn(function* (
    wallet: WalletPort,
    funded: FundedLink,
    destination: DestinationAddress,
  ) {
    world.accounts.set(addressOf(funded.link), accountState());

    const order = new ExternalLinkOrder({
      id: assetOrderId(),
      link: addressOf(funded.link),
      unclaimedFunds: funded.unclaimedFunds,
      destination,
    });

    const draft = yield* wallet.claimPaymentLink(order, Option.none());

    assertTagged(draft, "ExternalLinkDraft");
    assertTagged(
      yield* wallet.claimPaymentLink(
        order,
        approve(draft.request, funded.link),
      ),
      "ExternalLinkPending",
    );
    yield* settleSubmitted(funded.unclaimedFunds);
    assertTagged(
      yield* wallet.claimPaymentLink(order, Option.none()),
      "ExternalLinkSettled",
    );
  });

  return {
    payUsername,
    receiveInto,
    claimBalance,
    claimExternally,
  };
};
