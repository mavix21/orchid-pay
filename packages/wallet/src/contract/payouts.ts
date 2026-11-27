import * as Schema from "effect/Schema";
import { Asset, PositiveAmount } from "./assets";
import { AssetOrderId } from "./asset-orders";
import { AccountAddress } from "./identity";
import { UnclaimedFundsId } from "./unclaimed-funds";

export const PeruvianMobile = Schema.String.check(
  Schema.isPattern(/^9[0-9]{8}$/u),
).pipe(Schema.brand("PeruvianMobile"));

export type PeruvianMobile = typeof PeruvianMobile.Type;

export const YapeAccount = Schema.TaggedStruct("YapeAccount", {
  mobile: PeruvianMobile,
});

export type YapeAccount = typeof YapeAccount.Type;

export const PayoutDestination = Schema.Union([YapeAccount]);

export type PayoutDestination = typeof PayoutDestination.Type;

export const LocalCurrency = Schema.Literals(["PEN"]);

export type LocalCurrency = typeof LocalCurrency.Type;

export const LocalAmount = Schema.Struct({
  currency: LocalCurrency,
  minorUnits: Schema.BigIntFromString.check(Schema.isGreaterThanBigInt(0n)),
});

export type LocalAmount = typeof LocalAmount.Type;

export const sameLocalAmount = (left: LocalAmount, right: LocalAmount) =>
  left.currency === right.currency && left.minorUnits === right.minorUnits;

export const PayoutTerms = Schema.Struct({
  destination: PayoutDestination,
  local: LocalAmount,
});

export type PayoutTerms = typeof PayoutTerms.Type;

export class PayoutQuote extends Schema.TaggedClass<PayoutQuote>()(
  "PayoutQuote",
  {
    link: AccountAddress,
    unclaimedFunds: UnclaimedFundsId,
    asset: Asset,
    amount: PositiveAmount,
    local: LocalAmount,
    depositAddress: AccountAddress,
  },
) {}

export class PayoutUnavailable extends Schema.TaggedClass<PayoutUnavailable>()(
  "PayoutUnavailable",
  {},
) {}

export class PayoutQuoteChanged extends Schema.TaggedClass<PayoutQuoteChanged>()(
  "PayoutQuoteChanged",
  { quote: PayoutQuote },
) {}

const payoutFields = { id: AssetOrderId, local: LocalAmount };

export class PayoutSending extends Schema.TaggedClass<PayoutSending>()(
  "PayoutSending",
  payoutFields,
) {}

export class PayoutProcessing extends Schema.TaggedClass<PayoutProcessing>()(
  "PayoutProcessing",
  payoutFields,
) {}

export class PayoutCompleted extends Schema.TaggedClass<PayoutCompleted>()(
  "PayoutCompleted",
  { ...payoutFields, completedAt: Schema.DateTimeUtcFromString },
) {}

export class PayoutFailed extends Schema.TaggedClass<PayoutFailed>()(
  "PayoutFailed",
  { ...payoutFields, reason: Schema.Literals(["expired", "rejected"]) },
) {}

export class PayoutNotFound extends Schema.TaggedClass<PayoutNotFound>()(
  "PayoutNotFound",
  {},
) {}

export const PayoutStep = Schema.Union([
  PayoutSending,
  PayoutProcessing,
  PayoutCompleted,
  PayoutFailed,
  PayoutNotFound,
]);

export type PayoutStep = typeof PayoutStep.Type;
