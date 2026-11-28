import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  AssetUnsupported,
  type DestinationAddress,
  UnclaimedFundsLimitReached,
  LinkRecipient,
  RecipientCannotReceive,
  type ResolvedRecipient,
  type TransferOrder,
} from "../contract";
import { paymentLinkQuota } from "../policy";
import { Chain } from "./Chain.server";
import { type QuotaCheck, claimableQuotaFlow } from "./claimable-quota.server";

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

export const deliveryFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const { quotaFull } = yield* claimableQuotaFlow;

  const route = Effect.fn("Wallet.deliveryRoute")(function* (
    terms: TransferTerms,
    recipient: ResolvedRecipient,
    quota: QuotaCheck,
  ) {
    if (recipient instanceof LinkRecipient) {
      if (yield* quota(terms.from))
        return new UnclaimedFundsLimitReached({ limit: paymentLinkQuota });

      return DeliveryRoute.PaymentLink({ address: recipient.address });
    }

    const receivingAccount = Schema.decodeSync(AccountAddress)(
      recipient.address,
    );

    const blocker = yield* chain.receiveBlocker(
      receivingAccount,
      terms.asset,
      terms.amount,
    );

    if (Option.isSome(blocker))
      return new RecipientCannotReceive({
        address: receivingAccount,
        reason: blocker.value,
        linkable: blocker.value === "no_account",
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
  ) {
    const routed = yield* route(order, recipient, quotaFull);

    return isDeliveryRoute(routed) ? yield* draft(order, routed) : routed;
  });

  return { route, draft, delivery };
});
