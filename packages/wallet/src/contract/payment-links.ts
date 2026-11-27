import * as Schema from "effect/Schema";
import { Asset, PositiveAmount, withinAssetMaximum } from "./assets";
import { UnclaimedFundsId } from "./unclaimed-funds";
import { AccountAddress, Profile } from "./identity";

export const TransferId = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("TransferId"),
);

export type TransferId = typeof TransferId.Type;

export class PaymentLinkReceipt extends Schema.Class<PaymentLinkReceipt>(
  "@workspace/wallet/PaymentLinkReceipt",
)(
  Schema.Struct({
    network: Schema.String,
    address: AccountAddress,
    asset: Asset,
    amount: PositiveAmount,
    unclaimedFunds: UnclaimedFundsId,
    attempts: Schema.Array(UnclaimedFundsId),
  }).check(withinAssetMaximum),
) {}

export class OpenPaymentLink extends Schema.Class<OpenPaymentLink>(
  "@workspace/wallet/OpenPaymentLink",
)({
  id: TransferId,
  unclaimedFunds: UnclaimedFundsId,
  address: AccountAddress,
  asset: Asset,
  amount: PositiveAmount,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export class ReceivedPaymentLink extends Schema.Class<ReceivedPaymentLink>(
  "@workspace/wallet/ReceivedPaymentLink",
)({
  id: TransferId,
  address: AccountAddress,
  asset: Asset,
  amount: PositiveAmount,
  receivedAt: Schema.DateTimeUtcFromString,
}) {}

export class OpenPaymentLinks extends Schema.TaggedClass<OpenPaymentLinks>()(
  "OpenPaymentLinks",
  {
    links: Schema.Array(OpenPaymentLink),
    received: Schema.Array(ReceivedPaymentLink),
  },
) {}

export class ResolvedPaymentLink extends Schema.TaggedClass<ResolvedPaymentLink>()(
  "ResolvedPaymentLink",
  {
    unclaimedFunds: UnclaimedFundsId,
    address: AccountAddress,
    asset: Asset,
    amount: PositiveAmount,
  },
) {}

export class PaymentLinkNotFound extends Schema.TaggedClass<PaymentLinkNotFound>()(
  "PaymentLinkNotFound",
  {},
) {}

export class PaymentLinkReceiptInvalid extends Schema.TaggedClass<PaymentLinkReceiptInvalid>()(
  "PaymentLinkReceiptInvalid",
  {
    reason: Schema.Literals(["wrong_network", "ambiguous"]),
  },
) {}

export class PaymentLinkOpen extends Schema.TaggedClass<PaymentLinkOpen>()(
  "PaymentLinkOpen",
  {
    unclaimedFunds: UnclaimedFundsId,
    asset: Asset,
    amount: PositiveAmount,
    sender: Profile,
  },
) {}

export class PaymentLinkChecking extends Schema.TaggedClass<PaymentLinkChecking>()(
  "PaymentLinkChecking",
  {},
) {}

export class PaymentLinkUsed extends Schema.TaggedClass<PaymentLinkUsed>()(
  "PaymentLinkUsed",
  {},
) {}

export class PaymentLinkUnresolved extends Schema.TaggedClass<PaymentLinkUnresolved>()(
  "PaymentLinkUnresolved",
  {},
) {}

export class PaymentLinkUnrecognized extends Schema.TaggedClass<PaymentLinkUnrecognized>()(
  "PaymentLinkUnrecognized",
  {},
) {}
