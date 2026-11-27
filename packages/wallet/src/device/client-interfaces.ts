import type * as Effect from "effect/Effect";
import type {
  AssetOrderId,
  PasskeyChallenge,
  PayoutDestination,
  PayoutQuote,
  TransferId,
  TransferIntent,
} from "../contract";
import type { LinkCode } from "./link-code";
import type {
  BackUpOutcome,
  ConfirmExternalLinkOutcome,
  ConfirmLinkReceiveOutcome,
  ConfirmOpeningOutcome,
  ConfirmOutcome,
  ConfirmPaymentLinkOutcome,
  ConfirmPayoutOutcome,
  ConfirmReclaimOutcome,
  ConfirmSessionOutcome,
  DeviceOverview,
  ExternalLinkIntent,
  ExternalLinkReview,
  FollowPayoutOutcome,
  LinkReceiveReview,
  OpeningReview,
  PaymentLinkIntent,
  PaymentLinkOutcome,
  PaymentLinkTarget,
  PaymentLinksOutcome,
  PaymentReview,
  PayoutReview,
  QuotePayoutOutcome,
  ReclaimReview,
  ResolvePaymentLinkOutcome,
  RestoreOutcome,
  ResumeOutcome,
  RevealPaymentLinkOutcome,
  ReviewExternalLinkOutcome,
  ReviewLinkReceiveOutcome,
  ReviewOpeningOutcome,
  ReviewOutcome,
  ReviewPaymentLinkOutcome,
  ReviewPayoutOutcome,
  ReviewReclaimOutcome,
  SavedLinkTarget,
  SavedOutcome,
  SessionChallengeOutcome,
} from "./outcomes";

export interface WalletClient {
  overview(): Promise<DeviceOverview>;
  saved(): Promise<SavedOutcome>;
  sessionChallenge(): Promise<SessionChallengeOutcome>;
  confirmSession(challenge: PasskeyChallenge): Promise<ConfirmSessionOutcome>;
  reviewOpening(usernameText: string): Promise<ReviewOpeningOutcome>;
  confirmOpening(review: OpeningReview): Promise<ConfirmOpeningOutcome>;
  backUp(): Promise<BackUpOutcome>;
  restore(): Promise<RestoreOutcome>;
  cancelRestore(): Promise<void>;
  review(intent: TransferIntent): Promise<ReviewOutcome>;
  confirm(review: PaymentReview): Promise<ConfirmOutcome>;
  resume(id: TransferId): Promise<ResumeOutcome>;
  reviewPaymentLink(
    intent: PaymentLinkIntent,
  ): Promise<ReviewPaymentLinkOutcome>;
  confirmPaymentLink(review: PaymentReview): Promise<ConfirmPaymentLinkOutcome>;
  paymentLinks(): Promise<PaymentLinksOutcome>;
  resolvePaymentLink(): Promise<ResolvePaymentLinkOutcome>;
  revealPaymentLink(target: SavedLinkTarget): Promise<RevealPaymentLinkOutcome>;
  reviewReclaim(target: PaymentLinkTarget): Promise<ReviewReclaimOutcome>;
  confirmReclaim(review: ReclaimReview): Promise<ConfirmReclaimOutcome>;
  paymentLink(code: LinkCode): Promise<PaymentLinkOutcome>;
  reviewLinkReceive(code: LinkCode): Promise<ReviewLinkReceiveOutcome>;
  confirmLinkReceive(
    review: LinkReceiveReview,
    code: LinkCode,
  ): Promise<ConfirmLinkReceiveOutcome>;
  reviewExternalLinkClaim(
    code: LinkCode,
    intent: ExternalLinkIntent,
  ): Promise<ReviewExternalLinkOutcome>;
  confirmExternalLinkClaim(
    review: ExternalLinkReview,
    code: LinkCode,
  ): Promise<ConfirmExternalLinkOutcome>;
  quotePayout(code: LinkCode): Promise<QuotePayoutOutcome>;
  reviewPayout(
    code: LinkCode,
    destination: PayoutDestination,
    quote: PayoutQuote,
  ): Promise<ReviewPayoutOutcome>;
  confirmPayout(
    review: PayoutReview,
    code: LinkCode,
  ): Promise<ConfirmPayoutOutcome>;
  followPayout(id: AssetOrderId): Promise<FollowPayoutOutcome>;
}

export interface WalletEffects {
  overview(): Effect.Effect<DeviceOverview>;
  saved(): Effect.Effect<SavedOutcome>;
  sessionChallenge(): Effect.Effect<SessionChallengeOutcome>;
  confirmSession(
    challenge: PasskeyChallenge,
  ): Effect.Effect<ConfirmSessionOutcome>;
  reviewOpening(usernameText: string): Effect.Effect<ReviewOpeningOutcome>;
  confirmOpening(review: OpeningReview): Effect.Effect<ConfirmOpeningOutcome>;
  backUp(): Effect.Effect<BackUpOutcome>;
  restore(): Effect.Effect<RestoreOutcome>;
  cancelRestore(): Effect.Effect<void>;
  review(intent: TransferIntent): Effect.Effect<ReviewOutcome>;
  confirm(review: PaymentReview): Effect.Effect<ConfirmOutcome>;
  resume(id: TransferId): Effect.Effect<ResumeOutcome>;
  reviewPaymentLink(
    intent: PaymentLinkIntent,
  ): Effect.Effect<ReviewPaymentLinkOutcome>;
  confirmPaymentLink(
    review: PaymentReview,
  ): Effect.Effect<ConfirmPaymentLinkOutcome>;
  paymentLinks(): Effect.Effect<PaymentLinksOutcome>;
  resolvePaymentLink(): Effect.Effect<ResolvePaymentLinkOutcome>;
  revealPaymentLink(
    target: SavedLinkTarget,
  ): Effect.Effect<RevealPaymentLinkOutcome>;
  reviewReclaim(target: PaymentLinkTarget): Effect.Effect<ReviewReclaimOutcome>;
  confirmReclaim(review: ReclaimReview): Effect.Effect<ConfirmReclaimOutcome>;
  paymentLink(code: LinkCode): Effect.Effect<PaymentLinkOutcome>;
  reviewLinkReceive(code: LinkCode): Effect.Effect<ReviewLinkReceiveOutcome>;
  confirmLinkReceive(
    review: LinkReceiveReview,
    code: LinkCode,
  ): Effect.Effect<ConfirmLinkReceiveOutcome>;
  reviewExternalLinkClaim(
    code: LinkCode,
    intent: ExternalLinkIntent,
  ): Effect.Effect<ReviewExternalLinkOutcome>;
  confirmExternalLinkClaim(
    review: ExternalLinkReview,
    code: LinkCode,
  ): Effect.Effect<ConfirmExternalLinkOutcome>;
  quotePayout(code: LinkCode): Effect.Effect<QuotePayoutOutcome>;
  reviewPayout(
    code: LinkCode,
    destination: PayoutDestination,
    quote: PayoutQuote,
  ): Effect.Effect<ReviewPayoutOutcome>;
  confirmPayout(
    review: PayoutReview,
    code: LinkCode,
  ): Effect.Effect<ConfirmPayoutOutcome>;
  followPayout(id: AssetOrderId): Effect.Effect<FollowPayoutOutcome>;
}
