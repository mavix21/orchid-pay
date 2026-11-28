import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Asset, PositiveAmount, withinAssetMaximum } from "./assets";
import { type AccountAddress, Username } from "./identity";
import type { WalletUnavailable } from "./index";
import { NeedsReopening, NotOpened } from "./standing";

export const paymentRequestIdAlphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const paymentRequestIdLength = 10;

const paymentRequestIdPattern = new RegExp(
  `^[${paymentRequestIdAlphabet}]{${paymentRequestIdLength}}$`,
  "u",
);

export const PaymentRequestId = Schema.String.check(
  Schema.isPattern(paymentRequestIdPattern),
).pipe(Schema.brand("PaymentRequestId"));

export type PaymentRequestId = typeof PaymentRequestId.Type;

export const paymentRequestNoteMaxLength = 100;

export const PaymentRequestNote = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(paymentRequestNoteMaxLength),
  Schema.isTrimmed(),
  Schema.isPattern(/^[^\p{Cc}\p{Cs}\p{Zl}\p{Zp}]*$/u),
).pipe(Schema.brand("PaymentRequestNote"));

export type PaymentRequestNote = typeof PaymentRequestNote.Type;

const requestedFields = {
  id: PaymentRequestId,
  asset: Asset,
  amount: PositiveAmount,
  note: Schema.optional(PaymentRequestNote),
};

export class NewPaymentRequest extends Schema.Class<NewPaymentRequest>(
  "@workspace/wallet/NewPaymentRequest",
)(Schema.Struct(requestedFields).check(withinAssetMaximum)) {}

const paymentRequestFields = {
  ...requestedFields,
  requester: Username,
  createdAt: Schema.DateTimeUtcFromString,
};

export class PaymentRequestOpen extends Schema.TaggedClass<PaymentRequestOpen>()(
  "PaymentRequestOpen",
  paymentRequestFields,
) {}

export class PaymentRequestPaid extends Schema.TaggedClass<PaymentRequestPaid>()(
  "PaymentRequestPaid",
  paymentRequestFields,
) {}

export class PaymentRequestCancelled extends Schema.TaggedClass<PaymentRequestCancelled>()(
  "PaymentRequestCancelled",
  paymentRequestFields,
) {}

export class PaymentRequestNotFound extends Schema.TaggedClass<PaymentRequestNotFound>()(
  "PaymentRequestNotFound",
  {},
) {}

export class PaymentRequestAssetUnsupported extends Schema.TaggedClass<PaymentRequestAssetUnsupported>()(
  "PaymentRequestAssetUnsupported",
  {},
) {}

export class PaymentRequestBeingPaid extends Schema.TaggedClass<PaymentRequestBeingPaid>()(
  "PaymentRequestBeingPaid",
  {},
) {}

export class PaymentRequestSelfPay extends Schema.TaggedClass<PaymentRequestSelfPay>()(
  "PaymentRequestSelfPay",
  {},
) {}

export class PaymentRequestRequesterUnavailable extends Schema.TaggedClass<PaymentRequestRequesterUnavailable>()(
  "PaymentRequestRequesterUnavailable",
  {},
) {}

export class PaymentRequestPaymentTaken extends Schema.TaggedClass<PaymentRequestPaymentTaken>()(
  "PaymentRequestPaymentTaken",
  {},
) {}

export class PaymentRequestLimitReached extends Schema.TaggedClass<PaymentRequestLimitReached>()(
  "PaymentRequestLimitReached",
  { limit: Schema.Number },
) {}

export class PaymentRequestPayerUnfunded extends Schema.TaggedClass<PaymentRequestPayerUnfunded>()(
  "PaymentRequestPayerUnfunded",
  {},
) {}

export class PaymentRequestTransaction extends Schema.TaggedClass<PaymentRequestTransaction>()(
  "PaymentRequestTransaction",
  { request: PaymentRequestOpen, transaction: Schema.String },
) {}

export const PayPaymentRequestRefusal = Schema.Union([
  PaymentRequestPaid,
  PaymentRequestCancelled,
  PaymentRequestNotFound,
  PaymentRequestBeingPaid,
  PaymentRequestSelfPay,
  PaymentRequestRequesterUnavailable,
  PaymentRequestPaymentTaken,
]);

export type PayPaymentRequestRefusal = typeof PayPaymentRequestRefusal.Type;

export const ExternalPaymentStep = Schema.Union([
  PaymentRequestTransaction,
  PaymentRequestPaid,
  PaymentRequestCancelled,
  PaymentRequestNotFound,
  PaymentRequestBeingPaid,
  PaymentRequestSelfPay,
  PaymentRequestRequesterUnavailable,
  PaymentRequestPayerUnfunded,
]);

export type ExternalPaymentStep = typeof ExternalPaymentStep.Type;

export class OpenPaymentRequests extends Schema.TaggedClass<OpenPaymentRequests>()(
  "OpenPaymentRequests",
  { requests: Schema.Array(PaymentRequestOpen) },
) {}

export const CreatePaymentRequestStep = Schema.Union([
  PaymentRequestOpen,
  PaymentRequestPaid,
  PaymentRequestCancelled,
  PaymentRequestAssetUnsupported,
  PaymentRequestLimitReached,
  NotOpened,
  NeedsReopening,
]);

export type CreatePaymentRequestStep = typeof CreatePaymentRequestStep.Type;

export const PaymentRequestStep = Schema.Union([
  PaymentRequestOpen,
  PaymentRequestPaid,
  PaymentRequestCancelled,
  PaymentRequestNotFound,
]);

export type PaymentRequestStep = typeof PaymentRequestStep.Type;

export const OpenPaymentRequestsStep = Schema.Union([
  OpenPaymentRequests,
  NotOpened,
]);

export type OpenPaymentRequestsStep = typeof OpenPaymentRequestsStep.Type;

export const CancelPaymentRequestStep = Schema.Union([
  PaymentRequestCancelled,
  PaymentRequestPaid,
  PaymentRequestBeingPaid,
  PaymentRequestNotFound,
  NotOpened,
]);

export type CancelPaymentRequestStep = typeof CancelPaymentRequestStep.Type;

export interface PaymentRequestPort<E = WalletUnavailable> {
  create(
    address: AccountAddress,
    request: NewPaymentRequest,
  ): Effect.Effect<CreatePaymentRequestStep, E>;
  read(id: PaymentRequestId): Effect.Effect<PaymentRequestStep, E>;
  open(address: AccountAddress): Effect.Effect<OpenPaymentRequestsStep, E>;
  cancel(
    address: AccountAddress,
    id: PaymentRequestId,
  ): Effect.Effect<CancelPaymentRequestStep, E>;
}
