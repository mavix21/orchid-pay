import * as Schema from "effect/Schema";
import {
  AccountAddress,
  AssetDraft,
  AssetOrder,
  type AssetStep,
  Asset,
  UnclaimedFundsId,
  DestinationAddress,
  ExternalLinkDraft,
  ExternalLinkOrder,
  type ExternalLinkStep,
  OpenPaymentLink,
  type RequestActivityStep,
  type PayPaymentRequestRefusal,
  type OpenPaymentLinks,
  ReceivedPaymentLink,
  type AddressBound,
  type AssertionRefused,
  type BackupStored,
  type ChallengeIssued,
  type ChallengeRefused,
  PaymentMemo,
  type PaymentLinksStep,
  type PaymentLinkOpen,
  type PaymentLinkStep,
  PositiveAmount,
  type Receipt,
  type ResolveReceiptStep,
  type ResolvedPaymentLink,
  type Pending,
  type Settled,
  TransferDraft,
  TransferId,
  TransferOrder,
  type TransferStep,
  type NoBackup,
  OpeningDraft,
  Profile,
  type RegistrationRefused,
  type Holding,
  type InvalidAddress,
  type NeedsReopening,
  type NotOpened,
  type NotSponsored,
  type Opened,
  type OpeningPending,
  Username,
  type HumanCheckRefused,
  type UsernameTaken,
  type WalletUnavailable,
  LocalAmount,
  type NotClaimable,
  PayoutDestination,
  type PayoutQuote,
  type PayoutQuoteChanged,
  type PayoutStep,
  type PayoutUnavailable,
} from "../contract";
import { LinkCode } from "./link-code";
import type {
  AssertionRejected,
  PrfOutputMissing,
  WrongCredential,
} from "./assertion";
import { BackupState, type CorruptDeviceWallet } from "./key-store";
import type { SavedLinkCorrupt } from "./link-seal";
import type { PasskeyCancelled, PasskeyFailed } from "./passkeys";

export class NoWallet extends Schema.TaggedClass<NoWallet>()("NoWallet", {}) {}

export const SavedBackup = Schema.Literals([...BackupState.literals, "none"]);

export type SavedBackup = typeof SavedBackup.Type;

export class SavedWallet extends Schema.TaggedClass<SavedWallet>()(
  "SavedWallet",
  {
    username: Username,
    openingApproved: Schema.Boolean,
    backup: SavedBackup,
  },
) {}

export type SavedOutcome =
  | SavedWallet
  | NoWallet
  | UnsupportedDevice
  | WalletUnavailable;

export class InvalidUsername extends Schema.TaggedClass<InvalidUsername>()(
  "InvalidUsername",
  {},
) {}

export class UnsupportedDevice extends Schema.TaggedClass<UnsupportedDevice>()(
  "UnsupportedDevice",
  {},
) {}

export class DraftRejected extends Schema.TaggedClass<DraftRejected>()(
  "DraftRejected",
  {},
) {}

export class BackupUnsupported extends Schema.TaggedClass<BackupUnsupported>()(
  "BackupUnsupported",
  {},
) {}

export class WalletOnDevice extends Schema.TaggedClass<WalletOnDevice>()(
  "WalletOnDevice",
  {},
) {}

export class RestoreUnverified extends Schema.TaggedClass<RestoreUnverified>()(
  "RestoreUnverified",
  {},
) {}

export class BackupMismatch extends Schema.TaggedClass<BackupMismatch>()(
  "BackupMismatch",
  {},
) {}

export class Restored extends Schema.TaggedClass<Restored>()("Restored", {
  profile: Profile,
}) {}

export class BackupLocated extends Schema.TaggedClass<BackupLocated>()(
  "BackupLocated",
  { profile: Profile },
) {}

export class SessionConfirmed extends Schema.TaggedClass<SessionConfirmed>()(
  "SessionConfirmed",
  {},
) {}

export type SessionRefusal =
  | NoWallet
  | PasskeyCancelled
  | PasskeyFailed
  | WrongCredential
  | AssertionRejected
  | AssertionRefused
  | ChallengeRefused
  | NoBackup
  | UnsupportedDevice
  | CorruptDeviceWallet
  | WalletUnavailable;

export type SessionChallengeOutcome = ChallengeIssued | WalletUnavailable;

export type ConfirmSessionOutcome = SessionConfirmed | SessionRefusal;

export type EnrollmentRefusal =
  | BackupUnsupported
  | PasskeyCancelled
  | PasskeyFailed
  | ChallengeRefused
  | RegistrationRefused
  | UnsupportedDevice;

export type BackUpOutcome =
  | BackupStored
  | BackupUnsupported
  | EnrollmentRefusal
  | NoWallet
  | WalletUnavailable;

export type RestoreOutcome =
  | Restored
  | BackupLocated
  | BackupUnsupported
  | PasskeyCancelled
  | PasskeyFailed
  | ChallengeRefused
  | NoBackup
  | AssertionRefused
  | BackupMismatch
  | RestoreUnverified
  | UnsupportedDevice
  | CorruptDeviceWallet
  | WalletUnavailable;

export type DeviceOverview =
  | Holding
  | NeedsReopening
  | NotOpened
  | InvalidAddress
  | NoWallet
  | UnsupportedDevice
  | WalletUnavailable;

export type CreateOutcome =
  | InvalidAddress
  | NotSponsored
  | Opened
  | OpeningPending
  | UsernameTaken
  | AddressBound
  | HumanCheckRefused
  | InvalidUsername
  | NoWallet
  | UnsupportedDevice
  | DraftRejected
  | EnrollmentRefusal
  | WalletUnavailable;

export class OpeningReview extends Schema.TaggedClass<OpeningReview>()(
  "OpeningReview",
  {
    username: Username,
    address: AccountAddress,
    draft: OpeningDraft,
    redrafted: Schema.Boolean,
  },
) {}

export type ReviewOpeningOutcome = OpeningReview | CreateOutcome;

export type ConfirmOpeningOutcome =
  | ReviewOpeningOutcome
  | WrongCredential
  | AssertionRejected
  | PrfOutputMissing
  | CorruptDeviceWallet;

export class ApprovalOutstanding extends Schema.TaggedClass<ApprovalOutstanding>()(
  "ApprovalOutstanding",
  { order: TransferOrder },
) {}

export type SendOutcome =
  | Exclude<TransferStep, TransferDraft>
  | ApprovalOutstanding
  | DraftRejected
  | NoWallet
  | UnsupportedDevice
  | WalletUnavailable;

export class PaymentReview extends Schema.TaggedClass<PaymentReview>()(
  "PaymentReview",
  {
    order: TransferOrder,
    draft: TransferDraft,
    redrafted: Schema.Boolean,
    network: Schema.String,
    to: DestinationAddress,
    username: Schema.optional(Username),
    asset: Asset,
    amount: PositiveAmount,
    memo: Schema.optional(PaymentMemo),
    claimable: Schema.Boolean,
    expiresAt: Schema.DateTimeUtcFromString,
  },
) {}

export type ReviewOutcome = PaymentReview | SendOutcome;

export class NoTransfer extends Schema.TaggedClass<NoTransfer>()(
  "NoTransfer",
  {},
) {}

export type ResumeOutcome = NoTransfer | SendOutcome | Receipt;

export type ConfirmOutcome =
  | ResumeOutcome
  | PaymentReview
  | PasskeyCancelled
  | PasskeyFailed
  | WrongCredential
  | AssertionRejected
  | PrfOutputMissing
  | CorruptDeviceWallet;

export type ReviewRequestPaymentOutcome =
  | ReviewOutcome
  | PayPaymentRequestRefusal;

export type ConfirmRequestPaymentOutcome =
  | ConfirmOutcome
  | PayPaymentRequestRefusal;

export type ResumeRequestPaymentOutcome =
  | ResumeOutcome
  | PayPaymentRequestRefusal;

export class PaymentLinkIntent extends Schema.Class<PaymentLinkIntent>(
  "@workspace/wallet/PaymentLinkIntent",
)({
  asset: Asset,
  amount: PositiveAmount,
  saveOnDevice: Schema.Boolean,
}) {}

export interface PaymentLinkTarget {
  readonly unclaimedFunds: UnclaimedFundsId;
  readonly asset: Asset;
  readonly amount: PositiveAmount;
}

export interface SavedLinkTarget extends PaymentLinkTarget {
  readonly address: AccountAddress;
}

export class PaymentLinkCreated extends Schema.TaggedClass<PaymentLinkCreated>()(
  "PaymentLinkCreated",
  {
    id: TransferId,
    address: AccountAddress,
    code: LinkCode,
    unclaimedFunds: UnclaimedFundsId,
    asset: Asset,
    amount: PositiveAmount,
    network: Schema.String,
    path: Schema.String,
    settledAt: Schema.DateTimeUtcFromString,
    savedOnDevice: Schema.Boolean,
  },
) {}

export class LinkOutputMissing extends Schema.TaggedClass<LinkOutputMissing>()(
  "LinkOutputMissing",
  {},
) {}

export type ReviewPaymentLinkOutcome =
  | PaymentReview
  | Exclude<SendOutcome, Settled>;

export type ConfirmPaymentLinkOutcome =
  | PaymentLinkCreated
  | LinkOutputMissing
  | Exclude<ConfirmOutcome, Settled>;

export class ListedPaymentLink extends Schema.Class<ListedPaymentLink>(
  "@workspace/wallet/ListedPaymentLink",
)({
  ...OpenPaymentLink.fields,
  savedOnDevice: Schema.Boolean,
}) {}

export class ListedPaymentLinks extends Schema.TaggedClass<ListedPaymentLinks>()(
  "ListedPaymentLinks",
  {
    links: Schema.Array(ListedPaymentLink),
    received: Schema.Array(ReceivedPaymentLink),
  },
) {}

export type PaymentLinksOutcome =
  | ListedPaymentLinks
  | Exclude<PaymentLinksStep, OpenPaymentLinks>
  | NoWallet
  | UnsupportedDevice
  | WalletUnavailable;

export type ActivityOutcome =
  | RequestActivityStep
  | NoWallet
  | UnsupportedDevice
  | WalletUnavailable;

export class LatestPaymentLink extends Schema.TaggedClass<LatestPaymentLink>()(
  "LatestPaymentLink",
  {
    unclaimedFunds: UnclaimedFundsId,
    address: AccountAddress,
    asset: Asset,
    amount: PositiveAmount,
    savedOnDevice: Schema.Boolean,
  },
) {}

export type ResolvePaymentLinkOutcome =
  | LatestPaymentLink
  | Exclude<ResolveReceiptStep, ResolvedPaymentLink>
  | Pending
  | ApprovalOutstanding
  | NoWallet
  | UnsupportedDevice
  | WalletUnavailable;

export class ReclaimReview extends Schema.TaggedClass<ReclaimReview>()(
  "ReclaimReview",
  {
    order: AssetOrder,
    draft: AssetDraft,
    redrafted: Schema.Boolean,
    network: Schema.String,
    unclaimedFunds: UnclaimedFundsId,
    asset: Asset,
    amount: PositiveAmount,
  },
) {}

export type ReclaimOutcome =
  | Exclude<AssetStep, AssetDraft>
  | DraftRejected
  | NoWallet
  | UnsupportedDevice
  | WalletUnavailable;

export type ReviewReclaimOutcome = ReclaimReview | ReclaimOutcome;

export type ConfirmReclaimOutcome =
  | ReviewReclaimOutcome
  | PasskeyCancelled
  | PasskeyFailed
  | WrongCredential
  | AssertionRejected
  | PrfOutputMissing
  | CorruptDeviceWallet;

export class SavedLinkMissing extends Schema.TaggedClass<SavedLinkMissing>()(
  "SavedLinkMissing",
  {},
) {}

export class PaymentLinkRevealed extends Schema.TaggedClass<PaymentLinkRevealed>()(
  "PaymentLinkRevealed",
  {
    address: AccountAddress,
    code: LinkCode,
    path: Schema.String,
    unclaimedFunds: UnclaimedFundsId,
    asset: Asset,
    amount: PositiveAmount,
  },
) {}

export type RevealPaymentLinkOutcome =
  | PaymentLinkRevealed
  | SavedLinkMissing
  | SavedLinkCorrupt
  | PrfOutputMissing
  | PasskeyCancelled
  | PasskeyFailed
  | WrongCredential
  | AssertionRejected
  | NoWallet
  | UnsupportedDevice
  | CorruptDeviceWallet
  | WalletUnavailable;

export class LinkCodeMismatch extends Schema.TaggedClass<LinkCodeMismatch>()(
  "LinkCodeMismatch",
  {},
) {}

export interface LinkReceiveTarget {
  readonly link: AccountAddress;
  readonly unclaimedFunds: UnclaimedFundsId;
  readonly asset: Asset;
  readonly amount: PositiveAmount;
  readonly sender: Profile;
}

export class LinkReceiveReview extends Schema.TaggedClass<LinkReceiveReview>()(
  "LinkReceiveReview",
  {
    order: AssetOrder,
    draft: AssetDraft,
    redrafted: Schema.Boolean,
    network: Schema.String,
    link: AccountAddress,
    unclaimedFunds: UnclaimedFundsId,
    asset: Asset,
    amount: PositiveAmount,
    sender: Profile,
  },
) {}

export type PaymentLinkOutcome =
  | PaymentLinkStep
  | LinkCodeMismatch
  | UnsupportedDevice
  | WalletUnavailable;

export type ReviewLinkReceiveOutcome =
  | LinkReceiveReview
  | ReclaimOutcome
  | Exclude<PaymentLinkStep, PaymentLinkOpen>
  | LinkCodeMismatch;

export type ConfirmLinkReceiveOutcome =
  | ReviewLinkReceiveOutcome
  | PasskeyCancelled
  | PasskeyFailed
  | WrongCredential
  | AssertionRejected
  | PrfOutputMissing
  | CorruptDeviceWallet;

export class ExternalLinkIntent extends Schema.Class<ExternalLinkIntent>(
  "@workspace/wallet/ExternalLinkIntent",
)({
  destination: DestinationAddress,
  memo: Schema.optional(PaymentMemo),
}) {}

export class ExternalLinkReview extends Schema.TaggedClass<ExternalLinkReview>()(
  "ExternalLinkReview",
  {
    order: ExternalLinkOrder,
    draft: ExternalLinkDraft,
    redrafted: Schema.Boolean,
    network: Schema.String,
    link: AccountAddress,
    unclaimedFunds: UnclaimedFundsId,
    destination: DestinationAddress,
    asset: Asset,
    amount: PositiveAmount,
    memo: Schema.optional(PaymentMemo),
    sender: Profile,
  },
) {}

export type ExternalLinkOutcome =
  | Exclude<ExternalLinkStep, ExternalLinkDraft>
  | Exclude<PaymentLinkStep, PaymentLinkOpen>
  | LinkCodeMismatch
  | DraftRejected
  | WalletUnavailable;

export type ReviewExternalLinkOutcome =
  | ExternalLinkReview
  | ExternalLinkOutcome;

export type ConfirmExternalLinkOutcome = ReviewExternalLinkOutcome;

export class PayoutReview extends Schema.TaggedClass<PayoutReview>()(
  "PayoutReview",
  {
    claim: ExternalLinkReview,
    destination: PayoutDestination,
    local: LocalAmount,
  },
) {}

export type QuotePayoutOutcome =
  | PayoutQuote
  | PayoutUnavailable
  | NotClaimable
  | InvalidAddress
  | Exclude<PaymentLinkStep, PaymentLinkOpen>
  | LinkCodeMismatch
  | DraftRejected
  | WalletUnavailable;

export type ReviewPayoutOutcome =
  | PayoutReview
  | ExternalLinkOutcome
  | PayoutQuoteChanged
  | PayoutUnavailable;

export type ConfirmPayoutOutcome = ReviewPayoutOutcome;

export type FollowPayoutOutcome = PayoutStep | WalletUnavailable;
