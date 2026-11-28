import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import {
  type AccountAddress,
  type Approval,
  type AssetOrderId,
  type AssetPending,
  type ExternalLinkOrder,
  type ExternalLinkPending,
  type ExternalLinkStep,
  InvalidAddress,
  type LocalCurrency,
  NotClaimable,
  type PayoutClaimStep,
  PayoutCompleted,
  PayoutFailed,
  PayoutNotFound,
  type PayoutOrder,
  PayoutProcessing,
  PayoutQuote,
  PayoutQuoteChanged,
  type PayoutQuoteStep,
  PayoutSending,
  type PayoutStep,
  type PayoutTerms,
  PayoutUnavailable,
  payoutCurrency,
  sameLocalAmount,
} from "../contract";
import {
  type AssetAuthorized,
  AssetOrders,
  type ConcludedReceipt,
  StoredExternalOrder,
} from "./AssetOrders.server";
import { Chain, type ChainUnreachable } from "./Chain.server";
import type { StoreFailure } from "./Directory.server";
import { PayoutPartner } from "./PayoutPartner.server";
import { Transfers } from "./Transfers.server";

export interface PayoutClaims {
  readonly claimExternal: (
    order: ExternalLinkOrder,
    approval: Option.Option<Approval>,
    payout: Option.Option<PayoutTerms>,
  ) => Effect.Effect<ExternalLinkStep, StoreFailure | ChainUnreachable>;
  readonly reconcile: (
    stored: AssetAuthorized,
  ) => Effect.Effect<
    ConcludedReceipt | ExternalLinkPending | AssetPending,
    StoreFailure | ChainUnreachable
  >;
}

export const payoutFlow = (claims: PayoutClaims) =>
  Effect.gen(function* () {
    const chain = yield* Chain;
    const orders = yield* AssetOrders;
    const transfers = yield* Transfers;
    const partner = yield* PayoutPartner;

    const quotePayout = Effect.fn("Wallet.quotePayout")(function* (
      link: AccountAddress,
      currency: LocalCurrency,
    ): Effect.fn.Return<PayoutQuoteStep, StoreFailure> {
      if (!chain.validAddress(link))
        return new InvalidAddress({ address: link });

      const funded = yield* transfers.fundedLink(link);

      if (Option.isNone(funded))
        return new NotClaimable({ claimableAt: Option.none() });

      const { unclaimedFunds, asset, amount } = funded.value;
      const local = yield* partner.quote(asset, amount, currency);

      if (Option.isNone(local)) return new PayoutUnavailable();

      return new PayoutQuote({
        link,
        unclaimedFunds,
        asset,
        amount,
        local: local.value,
        depositAddress: partner.depositAddress,
      });
    });

    const termsCurrent = Effect.fn("Wallet.payoutTermsCurrent")(function* (
      order: PayoutOrder,
    ): Effect.fn.Return<Option.Option<PayoutClaimStep>, StoreFailure> {
      const { claim } = order;

      if (
        claim.destination !== partner.depositAddress ||
        claim.memo !== undefined
      )
        return Option.some(new InvalidAddress({ address: claim.destination }));

      const quote = yield* quotePayout(
        claim.link,
        payoutCurrency(order.destination),
      );

      if (!(quote instanceof PayoutQuote)) return Option.some(quote);

      if (quote.unclaimedFunds !== claim.unclaimedFunds)
        return Option.some(new NotClaimable({ claimableAt: Option.none() }));

      return sameLocalAmount(quote.local, order.local)
        ? Option.none()
        : Option.some(new PayoutQuoteChanged({ quote }));
    });

    const requestPayout = Effect.fn("Wallet.requestPayout")(function* (
      order: PayoutOrder,
      approval: Option.Option<Approval>,
    ): Effect.fn.Return<PayoutClaimStep, StoreFailure | ChainUnreachable> {
      const existing = yield* orders.find(order.claim.id);

      const committed = Option.exists(
        existing,
        (stored) => !Predicate.isTagged(stored, "AssetProposed"),
      );

      if (!committed) {
        const refusal = yield* termsCurrent(order);

        if (Option.isSome(refusal)) return refusal.value;
      }

      return yield* claims.claimExternal(
        order.claim,
        approval,
        Option.some({ destination: order.destination, local: order.local }),
      );
    });

    const progressed = Effect.fn("Wallet.payoutProgress")(function* (
      id: AssetOrderId,
      terms: PayoutTerms,
      receipt: ConcludedReceipt | ExternalLinkPending | AssetPending,
    ): Effect.fn.Return<PayoutStep> {
      const { local } = terms;

      if (Predicate.isTagged(receipt, "ExternalLinkSettled")) {
        const completedAt = yield* partner.completedAt({
          id,
          terms,
          settledAt: receipt.settledAt,
        });

        return Option.match(completedAt, {
          onNone: () => new PayoutProcessing({ id, local }),
          onSome: (at) => new PayoutCompleted({ id, local, completedAt: at }),
        });
      }

      if (Predicate.isTagged(receipt, "ExternalLinkFailed"))
        return new PayoutFailed({ id, local, reason: receipt.reason });

      return Predicate.isTagged(receipt, "ExternalLinkPending")
        ? new PayoutSending({ id, local })
        : new PayoutNotFound();
    });

    const payout = Effect.fn("Wallet.payout")(function* (
      id: AssetOrderId,
    ): Effect.fn.Return<PayoutStep, StoreFailure | ChainUnreachable> {
      const found = yield* orders.find(id);

      if (Option.isNone(found)) return new PayoutNotFound();

      const stored = found.value;

      if (
        !(stored.order instanceof StoredExternalOrder) ||
        stored.order.action.payout === undefined
      )
        return new PayoutNotFound();

      const terms = stored.order.action.payout;

      return yield* Match.valueTags(stored, {
        AssetProposed: () => Effect.succeed(new PayoutNotFound()),
        AssetAuthorized: (authorized) =>
          claims
            .reconcile(authorized)
            .pipe(Effect.flatMap((receipt) => progressed(id, terms, receipt))),
        AssetConcluded: (concluded) => progressed(id, terms, concluded.receipt),
      });
    });

    return { quotePayout, requestPayout, payout };
  });
