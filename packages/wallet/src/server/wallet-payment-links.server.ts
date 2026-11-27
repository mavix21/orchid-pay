import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import {
  type AccountAddress,
  type UnclaimedFundsId,
  InvalidAddress,
  NotOpened,
  OpenPaymentLink,
  OpenPaymentLinks,
  PaymentLinkNotFound,
  type PaymentLinkReceipt,
  PaymentLinkReceiptInvalid,
  type PaymentLinksStep,
  type ResolveReceiptStep,
  ResolvedPaymentLink,
  sameAsset,
} from "../contract";
import { network } from "../record-network";
import { Applied, Chain, type ChainUnreachable } from "./Chain.server";
import { claimableQuotaFlow } from "./claimable-quota.server";
import { Directory, type StoreFailure } from "./Directory.server";
import { recoverablePaymentLinks } from "./unclaimed-funds.server";
import { rpcReadConcurrency } from "./settings.server";
import { type Authorized, Transfers } from "./Transfers.server";

export const paymentLinksFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const directory = yield* Directory;
  const transfers = yield* Transfers;

  const { closeGoneUnclaimedFunds } = yield* claimableQuotaFlow;

  const paymentLinks = Effect.fn("Wallet.paymentLinks")(function* (
    address: AccountAddress,
  ): Effect.fn.Return<PaymentLinksStep, StoreFailure | ChainUnreachable> {
    if (!chain.validAddress(address)) return new InvalidAddress({ address });

    const row = yield* directory.byAddress(address);

    if (Option.isNone(row) || row.value.status !== "active")
      return new NotOpened();

    const pendingLinks = yield* transfers.openPaymentLinks(address);

    const entries = yield* chain.unclaimedFunds(
      pendingLinks.map((item) => item.unclaimedFunds),
    );

    const liveLinks = recoverablePaymentLinks(entries, address);
    const links: OpenPaymentLink[] = [];
    const missing: UnclaimedFundsId[] = [];

    for (const item of pendingLinks) {
      const matched = liveLinks.find(
        (candidate) =>
          candidate.unclaimedFunds === item.unclaimedFunds &&
          candidate.address === item.address,
      );

      if (!matched) {
        if (
          !entries.some((entry) => entry.unclaimedFunds === item.unclaimedFunds)
        )
          missing.push(item.unclaimedFunds);

        continue;
      }

      links.push(
        new OpenPaymentLink({
          id: item.id,
          unclaimedFunds: item.unclaimedFunds,
          address: item.address,
          asset: matched.asset,
          amount: matched.amount,
          createdAt: item.createdAt,
        }),
      );
    }

    yield* Effect.forEach(missing, closeGoneUnclaimedFunds, {
      concurrency: rpcReadConcurrency,
      discard: true,
    });

    return new OpenPaymentLinks({
      links,
      received: yield* transfers.receivedPaymentLinks(address),
    });
  });

  const reconcileLiveLink = Effect.fn("Wallet.reconcileLiveLink")(function* (
    authorized: Authorized,
  ) {
    if (
      authorized.unclaimedFunds === undefined ||
      !Predicate.isTagged(authorized.order.to, "PaymentLink")
    )
      return Option.none<Applied>();

    const expectedAddress = authorized.order.to.value;
    const entries = yield* chain.unclaimedFunds([authorized.unclaimedFunds]);

    const matched = recoverablePaymentLinks(
      entries,
      authorized.order.from,
    ).some(
      (entry) =>
        entry.unclaimedFunds === authorized.unclaimedFunds &&
        entry.address === expectedAddress &&
        sameAsset(entry.asset, authorized.order.asset) &&
        entry.amount === authorized.order.amount,
    );

    return matched
      ? Option.some(new Applied({ at: yield* DateTime.now }))
      : Option.none<Applied>();
  });

  const resolvePaymentLink = Effect.fn("Wallet.resolvePaymentLink")(function* (
    sender: AccountAddress,
    receipt: PaymentLinkReceipt,
  ): Effect.fn.Return<ResolveReceiptStep, StoreFailure | ChainUnreachable> {
    if (!chain.validAddress(sender))
      return new InvalidAddress({ address: sender });

    if (receipt.network !== network)
      return new PaymentLinkReceiptInvalid({ reason: "wrong_network" });

    const candidates = [
      ...new Set([receipt.unclaimedFunds, ...receipt.attempts]),
    ];

    const entries = yield* chain.unclaimedFunds(candidates);

    const matches = recoverablePaymentLinks(entries, sender).filter(
      (entry) =>
        entry.address === receipt.address &&
        sameAsset(entry.asset, receipt.asset) &&
        entry.amount === receipt.amount,
    );

    if (matches.length === 0) return new PaymentLinkNotFound();

    if (matches.length > 1)
      return new PaymentLinkReceiptInvalid({ reason: "ambiguous" });

    const match = matches[0];

    if (!match) return new PaymentLinkNotFound();

    const latest = yield* transfers.latestFrom(sender);

    if (
      Option.isSome(latest) &&
      Predicate.isTagged(latest.value, "Authorized") &&
      latest.value.unclaimedFunds === match.unclaimedFunds &&
      Predicate.isTagged(latest.value.order.to, "PaymentLink") &&
      latest.value.order.to.value === match.address &&
      sameAsset(latest.value.order.asset, match.asset) &&
      latest.value.order.amount === match.amount
    )
      yield* transfers.conclude(
        latest.value.order.id,
        new Applied({ at: yield* DateTime.now }),
      );

    return new ResolvedPaymentLink({
      unclaimedFunds: match.unclaimedFunds,
      address: match.address,
      asset: match.asset,
      amount: match.amount,
    });
  });

  return {
    paymentLinks,
    resolvePaymentLink,
    reconcileLiveLink,
    closeGoneUnclaimedFunds,
  };
});
