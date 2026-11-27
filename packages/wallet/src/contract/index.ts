import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Approval, type Approvals, SigningRequest } from "./approval";
import {
  AssetBusy,
  AssetDraft,
  AssetFailed,
  AssetOrder,
  AssetOrderId,
  AssetPending,
  AssetSettled,
  AssetUnsupported,
  UnclaimedFundsGone,
  LinkUnclaimable,
  NotClaimable,
  TrustlineLimitReached,
  TrustlineNotEmpty,
  Unchanged,
} from "./asset-orders";
import { Amount, Asset, PositiveAmount, withinAssetMaximum } from "./assets";
import {
  type BackupEnrollment,
  ChallengeIssued,
  ChallengeRefused,
  type PasskeyAssertion,
  type PasskeyChallenge,
  RegistrationRefused,
  type RestoreStep,
  type SessionStep,
} from "./backup";
import { UnclaimedFundsId } from "./unclaimed-funds";
import type { WalletUnavailable } from "./failures";
import { HumanCheckRefused, type HumanCheckToken } from "./human-check";
import {
  AccountAddress,
  DestinationAddress,
  Profile,
  Username,
} from "./identity";
import {
  OpenPaymentLinks,
  PaymentLinkChecking,
  PaymentLinkNotFound,
  PaymentLinkOpen,
  PaymentLinkReceipt,
  PaymentLinkReceiptInvalid,
  PaymentLinkUnrecognized,
  PaymentLinkUnresolved,
  PaymentLinkUsed,
  ResolvedPaymentLink,
  TransferId,
} from "./payment-links";
import {
  type CancelPaymentRequestStep,
  type OpenPaymentRequestsStep,
  PayPaymentRequestRefusal,
  type PaymentRequestId,
  PaymentRequestPaid,
  type PaymentRequestStep,
} from "./payment-requests";
import {
  PayoutDestination,
  PayoutQuote,
  PayoutQuoteChanged,
  type PayoutStep,
  PayoutUnavailable,
  LocalAmount,
} from "./payouts";
import { NeedsReopening, NotOpened, UnclaimedFunds } from "./standing";

export * from "./approval";

export * from "./asset-orders";

export * from "./assets";

export * from "./failures";

export * from "./backup";

export * from "./unclaimed-funds";

export * from "./human-check";

export * from "./identity";

export * from "./network-addresses";

export * from "./payment-links";

export * from "./payment-requests";

export * from "./payouts";

export * from "./standing";

export class InvalidAddress extends Schema.TaggedClass<InvalidAddress>()(
  "InvalidAddress",
  {
    address: DestinationAddress,
  },
) {}

export class NotSponsored extends Schema.TaggedClass<NotSponsored>()(
  "NotSponsored",
  {},
) {}

export class ExternalMemoRequired extends Schema.TaggedClass<ExternalMemoRequired>()(
  "ExternalMemoRequired",
  {
    address: AccountAddress,
    exchange: Schema.NonEmptyString,
    source: Schema.String,
  },
) {}

export class WalletClaim extends Schema.Class<WalletClaim>(
  "@workspace/wallet/WalletClaim",
)({
  username: Username,
  address: AccountAddress,
}) {}

export class OpeningDraft extends Schema.TaggedClass<OpeningDraft>()(
  "OpeningDraft",
  {
    request: SigningRequest,
  },
) {}

export class OpeningPending extends Schema.TaggedClass<OpeningPending>()(
  "OpeningPending",
  {},
) {}

export class Opened extends Schema.TaggedClass<Opened>()("Opened", {
  profile: Profile,
}) {}

export class UsernameTaken extends Schema.TaggedClass<UsernameTaken>()(
  "UsernameTaken",
  {
    username: Username,
  },
) {}

export class AddressBound extends Schema.TaggedClass<AddressBound>()(
  "AddressBound",
  {
    profile: Profile,
  },
) {}

export const OpenStep = Schema.Union([
  OpeningDraft,
  OpeningPending,
  Opened,
  UsernameTaken,
  AddressBound,
  HumanCheckRefused,
  InvalidAddress,
  NotSponsored,
]);

export type OpenStep = typeof OpenStep.Type;

export const EnrollmentChallengeStep = Schema.Union([
  ChallengeIssued,
  UsernameTaken,
  AddressBound,
  HumanCheckRefused,
]);

export type EnrollmentChallengeStep = typeof EnrollmentChallengeStep.Type;

export const EnrollStep = Schema.Union([
  OpeningDraft,
  OpeningPending,
  Opened,
  UsernameTaken,
  AddressBound,
  InvalidAddress,
  NotSponsored,
  ChallengeRefused,
  RegistrationRefused,
]);

export type EnrollStep = typeof EnrollStep.Type;

export const PaymentMemo = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("text"),
    value: Schema.String.check(
      Schema.makeFilter((value) => {
        const bytes = new TextEncoder().encode(value);

        return (
          bytes.length > 0 &&
          bytes.length <= 28 &&
          new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) === value
        );
      }),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("id"),
    value: Schema.String.check(
      Schema.isPattern(/^(0|[1-9][0-9]{0,19})$/u),
      Schema.makeFilter(
        (value) =>
          /^[0-9]+$/.test(value) && BigInt(value) <= 18446744073709551615n,
      ),
    ),
  }),
]);

export type PaymentMemo = typeof PaymentMemo.Type;

export class MemoNotAllowed extends Schema.TaggedClass<MemoNotAllowed>()(
  "MemoNotAllowed",
  { reason: Schema.Literals(["orchid", "muxed", "payment_link"]) },
) {}

export const UsernameRecipient = Schema.TaggedStruct("Username", {
  value: Username,
});

export const PhoneRecipient = Schema.TaggedStruct("Phone", {
  value: Schema.String,
});

export const AddressRecipient = Schema.TaggedStruct("Address", {
  value: DestinationAddress,
});

export const PaymentLinkRecipient = Schema.TaggedStruct("PaymentLink", {
  value: AccountAddress,
});

export const Recipient = Schema.Union([
  UsernameRecipient,
  PhoneRecipient,
  AddressRecipient,
  PaymentLinkRecipient,
]);

export type Recipient = typeof Recipient.Type;

const transferIntentFields = {
  to: Recipient,
  asset: Asset,
  amount: PositiveAmount,
  memo: Schema.optional(PaymentMemo),
};

export class TransferIntent extends Schema.Class<TransferIntent>(
  "@workspace/wallet/TransferIntent",
)(Schema.Struct(transferIntentFields).check(withinAssetMaximum)) {}

export class TransferOrder extends Schema.Class<TransferOrder>(
  "@workspace/wallet/TransferOrder",
)(
  Schema.Struct({
    id: TransferId,
    from: AccountAddress,
    ...transferIntentFields,
  }).check(withinAssetMaximum),
) {}

export class LinkRecipient extends Schema.Class<LinkRecipient>(
  "@workspace/wallet/LinkRecipient",
)({
  kind: Schema.Literal("paymentLink"),
  address: AccountAddress,
}) {}

export class ExternalRecipient extends Schema.Class<ExternalRecipient>(
  "@workspace/wallet/ExternalRecipient",
)({ address: DestinationAddress }) {}

export const ResolvedRecipient = Schema.Union([
  Profile,
  LinkRecipient,
  ExternalRecipient,
]);

export type ResolvedRecipient = typeof ResolvedRecipient.Type;

const transferFields = {
  id: TransferId,
  to: Recipient,
  recipient: ResolvedRecipient,
  asset: Asset,
  amount: PositiveAmount,
  memo: Schema.optional(PaymentMemo),

  unclaimedFunds: Schema.optional(UnclaimedFundsId),
};

export class Pending extends Schema.TaggedClass<Pending>()("Pending", {
  ...transferFields,
  expiresAt: Schema.DateTimeUtcFromString,
}) {}

export class Settled extends Schema.TaggedClass<Settled>()("Settled", {
  ...transferFields,
  settledAt: Schema.DateTimeUtcFromString,
}) {}

export class Failed extends Schema.TaggedClass<Failed>()("Failed", {
  ...transferFields,
  reason: Schema.Literals(["expired", "rejected"]),
}) {}

export class Reserved extends Schema.TaggedClass<Reserved>()(
  "Reserved",
  transferFields,
) {}

export class Claimed extends Schema.TaggedClass<Claimed>()("Claimed", {
  ...transferFields,
  by: Schema.optional(Schema.Union([Profile, ExternalRecipient])),
  closedAt: Schema.DateTimeUtcFromString,
}) {}

export class Refunded extends Schema.TaggedClass<Refunded>()("Refunded", {
  ...transferFields,
  closedAt: Schema.DateTimeUtcFromString,
}) {}

export const Receipt = Schema.Union([
  Pending,
  Settled,
  Failed,
  Reserved,
  Claimed,
  Refunded,
]);

export type Receipt = typeof Receipt.Type;

export class TransferDraft extends Schema.TaggedClass<TransferDraft>()(
  "TransferDraft",
  {
    request: SigningRequest,
    recipient: ResolvedRecipient,
    memoRequired: Schema.Boolean,

    unclaimedFunds: Schema.optional(UnclaimedFundsId),
  },
) {}

export const ActivityCursor = Schema.String.check(
  Schema.isPattern(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
  ),
).pipe(Schema.brand("ActivityCursor"));

export type ActivityCursor = typeof ActivityCursor.Type;

export class SentActivity extends Schema.TaggedClass<SentActivity>()(
  "SentActivity",
  {
    id: TransferId,
    createdAt: Schema.DateTimeUtcFromString,
    receipt: Receipt,
  },
) {}

const receivedActivityFields = {
  id: TransferId,
  createdAt: Schema.DateTimeUtcFromString,
  from: Profile,
  asset: Asset,
  amount: PositiveAmount,
};

export class ReceivedActivity extends Schema.TaggedClass<ReceivedActivity>()(
  "ReceivedActivity",
  {
    ...receivedActivityFields,
    closedAt: Schema.optional(Schema.DateTimeUtcFromString),
  },
) {}

export class AwaitingAcceptanceActivity extends Schema.TaggedClass<AwaitingAcceptanceActivity>()(
  "AwaitingAcceptanceActivity",
  { ...receivedActivityFields, unclaimedFunds: UnclaimedFundsId },
) {}

export class TakenBackActivity extends Schema.TaggedClass<TakenBackActivity>()(
  "TakenBackActivity",
  {
    ...receivedActivityFields,
    closedAt: Schema.DateTimeUtcFromString,
  },
) {}

export class ClaimedLinkActivity extends Schema.TaggedClass<ClaimedLinkActivity>()(
  "ClaimedLinkActivity",
  {
    id: AssetOrderId,
    createdAt: Schema.DateTimeUtcFromString,
    from: Profile,
    asset: Asset,
    amount: PositiveAmount,
  },
) {}

export const DepositId = Schema.String.check(Schema.isUUID(4)).pipe(
  Schema.brand("DepositId"),
);

export type DepositId = typeof DepositId.Type;

export class DepositActivity extends Schema.TaggedClass<DepositActivity>()(
  "DepositActivity",
  {
    id: DepositId,
    createdAt: Schema.DateTimeUtcFromString,
    from: ExternalRecipient,
    asset: Asset,
    amount: PositiveAmount,
  },
) {}

export const ActivityEntry = Schema.Union([
  SentActivity,
  ReceivedActivity,
  AwaitingAcceptanceActivity,
  TakenBackActivity,
  ClaimedLinkActivity,
  DepositActivity,
]);

export type ActivityEntry = typeof ActivityEntry.Type;

export class ActivityPage extends Schema.TaggedClass<ActivityPage>()(
  "ActivityPage",
  {
    entries: Schema.Array(ActivityEntry),
    next: Schema.optional(ActivityCursor),
  },
) {}

export class UnknownRecipient extends Schema.TaggedClass<UnknownRecipient>()(
  "UnknownRecipient",
  {
    username: Username,
  },
) {}

export class PhoneNotSupported extends Schema.TaggedClass<PhoneNotSupported>()(
  "PhoneNotSupported",
  {},
) {}

export class InsufficientBalance extends Schema.TaggedClass<InsufficientBalance>()(
  "InsufficientBalance",
  { available: Amount },
) {}

export class RecipientCannotReceive extends Schema.TaggedClass<RecipientCannotReceive>()(
  "RecipientCannotReceive",
  {
    address: AccountAddress,
    reason: Schema.Literals([
      "no_account",
      "no_trustline",
      "not_authorized",
      "no_capacity",
    ]),
    linkable: Schema.optional(Schema.Boolean),
  },
) {}

export class UnclaimedFundsLimitReached extends Schema.TaggedClass<UnclaimedFundsLimitReached>()(
  "UnclaimedFundsLimitReached",
  { limit: Schema.Number },
) {}

export class SenderBusy extends Schema.TaggedClass<SenderBusy>()("SenderBusy", {
  inFlight: Pending,
}) {}

export const TransferStep = Schema.Union([
  TransferDraft,
  Pending,
  Settled,
  Failed,
  NotOpened,
  UnknownRecipient,
  PhoneNotSupported,
  InsufficientBalance,
  SenderBusy,
  InvalidAddress,
  ExternalMemoRequired,
  MemoNotAllowed,
  RecipientCannotReceive,
  UnclaimedFundsLimitReached,
  AssetUnsupported,
  AssetBusy,
]);

export type TransferStep = typeof TransferStep.Type;

export const PayPaymentRequestStep = Schema.Union([
  ...TransferStep.members,
  ...PayPaymentRequestRefusal.members,
]);

export type PayPaymentRequestStep = typeof PayPaymentRequestStep.Type;

const memoRequirementFields = {
  memoRequired: Schema.Boolean,
  exchange: Schema.OptionFromNullOr(Schema.String),
};

export class TransferAssessment extends Schema.TaggedClass<TransferAssessment>()(
  "TransferAssessment",
  { recipient: ResolvedRecipient, ...memoRequirementFields },
) {}

export class RecipientCheck extends Schema.TaggedClass<RecipientCheck>()(
  "RecipientCheck",
  {
    recipient: Schema.Union([Profile, ExternalRecipient]),
    ...memoRequirementFields,
  },
) {}

export const CheckedRecipient = Schema.Union([
  UsernameRecipient,
  PhoneRecipient,
  AddressRecipient,
]);

export type CheckedRecipient = typeof CheckedRecipient.Type;

export const RecipientStep = Schema.Union([
  RecipientCheck,
  UnknownRecipient,
  PhoneNotSupported,
  InvalidAddress,
]);

export type RecipientStep = typeof RecipientStep.Type;

export const AssessmentStep = Schema.Union([
  TransferAssessment,
  NotOpened,
  UnknownRecipient,
  PhoneNotSupported,
  InsufficientBalance,
  SenderBusy,
  InvalidAddress,
  ExternalMemoRequired,
  MemoNotAllowed,
  RecipientCannotReceive,
  UnclaimedFundsLimitReached,
  AssetUnsupported,
]);

export type AssessmentStep = typeof AssessmentStep.Type;

export const AssetStep = Schema.Union([
  AssetDraft,
  AssetPending,
  AssetSettled,
  AssetFailed,
  NotOpened,
  InvalidAddress,
  SenderBusy,
  AssetBusy,
  Unchanged,
  TrustlineLimitReached,
  TrustlineNotEmpty,
  AssetUnsupported,
  RecipientCannotReceive,
  NotClaimable,
  UnclaimedFundsGone,
  LinkUnclaimable,
]);

export type AssetStep = typeof AssetStep.Type;

export const PaymentLinksStep = Schema.Union([
  OpenPaymentLinks,
  NotOpened,
  InvalidAddress,
]);

export type PaymentLinksStep = typeof PaymentLinksStep.Type;

export const ActivityStep = Schema.Union([
  ActivityPage,
  NotOpened,
  InvalidAddress,
]);

export type ActivityStep = typeof ActivityStep.Type;

export const PaidRequest = Schema.Struct({
  payment: TransferId,
  request: PaymentRequestPaid,
});

export type PaidRequest = typeof PaidRequest.Type;

export class RequestActivityPage extends Schema.TaggedClass<RequestActivityPage>()(
  "RequestActivityPage",
  { page: ActivityPage, paidRequests: Schema.Array(PaidRequest) },
) {}

export const RequestActivityStep = Schema.Union([
  RequestActivityPage,
  NotOpened,
  InvalidAddress,
]);

export type RequestActivityStep = typeof RequestActivityStep.Type;

export const ResolveReceiptStep = Schema.Union([
  ResolvedPaymentLink,
  PaymentLinkNotFound,
  PaymentLinkReceiptInvalid,
  InvalidAddress,
]);

export type ResolveReceiptStep = typeof ResolveReceiptStep.Type;

export const PaymentLinkStep = Schema.Union([
  PaymentLinkOpen,
  PaymentLinkChecking,
  PaymentLinkUsed,
  PaymentLinkUnresolved,
  PaymentLinkUnrecognized,
  PaymentLinkNotFound,
  InvalidAddress,
]);

export type PaymentLinkStep = typeof PaymentLinkStep.Type;

export class ExternalLinkOrder extends Schema.Class<ExternalLinkOrder>(
  "@workspace/wallet/ExternalLinkOrder",
)({
  id: AssetOrderId,
  link: AccountAddress,
  unclaimedFunds: UnclaimedFundsId,
  destination: DestinationAddress,
  memo: Schema.optional(PaymentMemo),
}) {}

export class ExternalLinkDraft extends Schema.TaggedClass<ExternalLinkDraft>()(
  "ExternalLinkDraft",
  {
    request: SigningRequest,
    memoRequired: Schema.Boolean,
  },
) {}

export class ExternalLinkPending extends Schema.TaggedClass<ExternalLinkPending>()(
  "ExternalLinkPending",
  {
    id: AssetOrderId,
    expiresAt: Schema.DateTimeUtcFromString,
  },
) {}

export class ExternalLinkSettled extends Schema.TaggedClass<ExternalLinkSettled>()(
  "ExternalLinkSettled",
  {
    id: AssetOrderId,
    settledAt: Schema.DateTimeUtcFromString,
  },
) {}

export class ExternalLinkFailed extends Schema.TaggedClass<ExternalLinkFailed>()(
  "ExternalLinkFailed",
  {
    id: AssetOrderId,
    reason: Schema.Literals(["expired", "rejected"]),
  },
) {}

export const ExternalLinkStep = Schema.Union([
  ExternalLinkDraft,
  ExternalLinkPending,
  ExternalLinkSettled,
  ExternalLinkFailed,
  InvalidAddress,
  ExternalMemoRequired,
  MemoNotAllowed,
  RecipientCannotReceive,
  NotClaimable,
  UnclaimedFundsGone,
  LinkUnclaimable,
  PaymentLinkChecking,
]);

export type ExternalLinkStep = typeof ExternalLinkStep.Type;

export class PayoutOrder extends Schema.Class<PayoutOrder>(
  "@workspace/wallet/PayoutOrder",
)({
  claim: ExternalLinkOrder,
  destination: PayoutDestination,
  local: LocalAmount,
}) {}

export const PayoutQuoteStep = Schema.Union([
  PayoutQuote,
  PayoutUnavailable,
  NotClaimable,
  InvalidAddress,
]);

export type PayoutQuoteStep = typeof PayoutQuoteStep.Type;

export const PayoutClaimStep = Schema.Union([
  ...ExternalLinkStep.members,
  PayoutQuoteChanged,
  PayoutUnavailable,
]);

export type PayoutClaimStep = typeof PayoutClaimStep.Type;

export class Balance extends Schema.Class<Balance>("@workspace/wallet/Balance")(
  {
    asset: Asset,
    amount: Amount,
  },
) {}

export class Holding extends Schema.TaggedClass<Holding>()("Holding", {
  profile: Profile,
  reserveSponsor: Schema.OptionFromNullOr(AccountAddress).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),

  balances: Schema.Array(Balance),
  unclaimedFunds: Schema.Array(UnclaimedFunds),
  latest: Schema.OptionFromNullOr(Receipt),
}) {}

export const Overview = Schema.Union([
  NotOpened,
  Holding,
  NeedsReopening,
  InvalidAddress,
]);

export type Overview = typeof Overview.Type;

export interface WalletPort<E = WalletUnavailable> {
  overview(address: AccountAddress): Effect.Effect<Overview, E>;
  open(
    claim: WalletClaim,
    approvals: Option.Option<Approvals>,
    humanCheck?: Option.Option<HumanCheckToken>,
  ): Effect.Effect<OpenStep, E>;
  transfer(
    order: TransferOrder,
    approval: Option.Option<Approval>,
  ): Effect.Effect<TransferStep, E>;
  manage(
    order: AssetOrder,
    approval: Option.Option<Approval>,
  ): Effect.Effect<AssetStep, E>;
  paymentLinks(address: AccountAddress): Effect.Effect<PaymentLinksStep, E>;
  activity(
    address: AccountAddress,
    before?: ActivityCursor,
  ): Effect.Effect<ActivityStep, E>;
  paymentLink(link: AccountAddress): Effect.Effect<PaymentLinkStep, E>;
  claimPaymentLink(
    order: ExternalLinkOrder,
    approval: Option.Option<Approval>,
  ): Effect.Effect<ExternalLinkStep, E>;
  resolvePaymentLink(
    sender: AccountAddress,
    receipt: PaymentLinkReceipt,
  ): Effect.Effect<ResolveReceiptStep, E>;
  quotePayout(link: AccountAddress): Effect.Effect<PayoutQuoteStep, E>;
  requestPayout(
    order: PayoutOrder,
    approval: Option.Option<Approval>,
  ): Effect.Effect<PayoutClaimStep, E>;
  payout(id: AssetOrderId): Effect.Effect<PayoutStep, E>;
  restoreChallenge(): Effect.Effect<PasskeyChallenge, E>;
  enrollmentChallenge(
    claim: WalletClaim,
    humanCheck?: Option.Option<HumanCheckToken>,
  ): Effect.Effect<EnrollmentChallengeStep, E>;
  enroll(
    enrollment: BackupEnrollment,
    approvals: Approvals,
  ): Effect.Effect<EnrollStep, E>;
  restore(assertion: PasskeyAssertion): Effect.Effect<RestoreStep, E>;
  sessionChallenge(): Effect.Effect<PasskeyChallenge, E>;
  beginSession(assertion: PasskeyAssertion): Effect.Effect<SessionStep, E>;
}

export interface RequestPaymentsPort<E = WalletUnavailable> {
  pay(
    id: PaymentRequestId,
    order: TransferOrder,
    approval: Option.Option<Approval>,
  ): Effect.Effect<PayPaymentRequestStep, E>;
  read(id: PaymentRequestId): Effect.Effect<PaymentRequestStep, E>;
  open(address: AccountAddress): Effect.Effect<OpenPaymentRequestsStep, E>;
  cancel(
    address: AccountAddress,
    id: PaymentRequestId,
  ): Effect.Effect<CancelPaymentRequestStep, E>;
  activity(
    address: AccountAddress,
    before?: ActivityCursor,
  ): Effect.Effect<RequestActivityStep, E>;
}
