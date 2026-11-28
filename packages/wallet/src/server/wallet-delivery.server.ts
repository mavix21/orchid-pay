import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import {
  type AccountAddress,
  AssetUnsupported,
  type DestinationAddress,
  UnclaimedFundsLimitReached,
  LinkRecipient,
  RecipientCannotReceive,
  type ResolvedRecipient,
  type TransferOrder,
  sameAsset,
  isNativeAsset,
} from "../contract";
import { paymentLinkQuota } from "../policy";
import { Chain } from "./Chain.server";
import { type QuotaCheck, claimableQuotaFlow } from "./claimable-quota.server";
import type { Holdings } from "./holdings.server";
import { rpcReadConcurrency } from "./settings.server";

export type TransferTerms = Pick<
  TransferOrder,
  "from" | "to" | "asset" | "amount" | "memo"
>;

export type DeliveryRoute = Data.TaggedEnum<{
  PaymentLink: { readonly address: AccountAddress };
  Payment: { readonly address: DestinationAddress };
}>;

export const DeliveryRoute = Data.taggedEnum<DeliveryRoute>();

export type DeliveryRefusal =
  | AssetUnsupported
  | UnclaimedFundsLimitReached
  | RecipientCannotReceive;

export const isDeliveryRoute = (
  value: DeliveryRoute | DeliveryRefusal,
): value is DeliveryRoute =>
  DeliveryRoute.$is("PaymentLink")(value) ||
  DeliveryRoute.$is("Payment")(value);

export const paymentLinkAssetRefusal = Effect.gen(function* () {
  const chain = yield* Chain;

  return Effect.fn("Wallet.paymentLinkAssetRefusal")(function* (
    order: TransferTerms,
    senderHoldings?: Holdings,
  ) {
    const { asset } = order;

    if (isNativeAsset(asset)) return Option.none<AssetUnsupported>();

    const [holdings, issuer] = yield* Effect.all(
      [
        senderHoldings === undefined
          ? chain.holdings(order.from, [asset])
          : Effect.succeed(Option.some(senderHoldings)),
        chain.issuer(asset),
      ],
      { concurrency: rpcReadConcurrency },
    );

    const sourceLine = Option.flatMap(holdings, (state) =>
      Option.fromNullishOr(
        state.lines.find((line) => sameAsset(line.asset, asset)),
      ),
    );

    if (Option.isSome(sourceLine) && sourceLine.value.clawbackEnabled)
      return Option.some(new AssetUnsupported({ reason: "clawback_enabled" }));

    if (Option.isNone(issuer))
      return Option.some(new AssetUnsupported({ reason: "issuer_missing" }));

    if (issuer.value.authRequired)
      return Option.some(
        new AssetUnsupported({ reason: "authorization_required" }),
      );

    return Option.none<AssetUnsupported>();
  });
});

export const deliveryFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const { quotaFull } = yield* claimableQuotaFlow;
  const checkLinkAsset = yield* paymentLinkAssetRefusal;

  const route = Effect.fn("Wallet.deliveryRoute")(function* (
    terms: TransferTerms,
    recipient: ResolvedRecipient,
    quota: QuotaCheck,
    senderHoldings?: Holdings,
  ) {
    if (recipient instanceof LinkRecipient) {
      const refusal = yield* checkLinkAsset(terms, senderHoldings);

      if (Option.isSome(refusal)) return refusal.value;

      if (yield* quota(terms.from))
        return new UnclaimedFundsLimitReached({ limit: paymentLinkQuota });

      return DeliveryRoute.PaymentLink({ address: recipient.address });
    }

    const receivingAccount = chain.receivingAccount(recipient.address);

    const blocker = yield* chain.receiveBlocker(
      receivingAccount,
      terms.asset,
      terms.amount,
    );

    if (Option.isSome(blocker))
      return new RecipientCannotReceive({
        address: receivingAccount,
        reason: blocker.value,
        linkable:
          blocker.value === "no_account" &&
          Option.isNone(yield* checkLinkAsset(terms, senderHoldings)),
      });

    return DeliveryRoute.Payment({ address: recipient.address });
  });

  const draft = (order: TransferOrder, delivery: DeliveryRoute) =>
    Match.valueTags(delivery, {
      PaymentLink: ({ address }) =>
        chain.draftPaymentLink(order.from, address, order.asset, order.amount),
      Payment: ({ address }) =>
        chain.draftPayment(
          order.from,
          address,
          order.asset,
          order.amount,
          order.memo,
        ),
    });

  const delivery = Effect.fn("Wallet.delivery")(function* (
    order: TransferOrder,
    recipient: ResolvedRecipient,
    senderHoldings?: Holdings,
  ) {
    const routed = yield* route(order, recipient, quotaFull, senderHoldings);

    return isDeliveryRoute(routed) ? yield* draft(order, routed) : routed;
  });

  return { route, draft, delivery };
});
