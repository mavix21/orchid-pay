import {
  type Asset,
  ExternalLinkFailed,
  type PayoutQuote,
  type PayoutQuoteChanged,
  type PayoutReview,
  PayoutUnavailable,
  type QuotePayoutOutcome,
  type ReviewPayoutOutcome,
} from "@workspace/wallet";
import * as Match from "effect/Match";

import { LinkScreen } from "@/links/outcomes";
import { m } from "@/paraglide/messages";
import type { DeviceFailure } from "@/send/use-wallet-task";

import {
  type ExternalClaimAction,
  reviewExternalResult,
} from "./external-claim-outcomes";

export type PayoutConclusion =
  | Exclude<QuotePayoutOutcome, PayoutQuote>
  | Exclude<ReviewPayoutOutcome, PayoutReview | PayoutQuoteChanged>
  | DeviceFailure;

export const payoutFailedScreen = () =>
  new LinkScreen<ExternalClaimAction>(
    m.payout_failed_title(),
    m.payout_failed_note(),
    "check",
  );

export const payoutNotFoundScreen = () =>
  new LinkScreen<ExternalClaimAction>(
    m.payout_not_found_title(),
    m.payout_not_found_note(),
    "check",
  );

export const payoutScreen = (
  outcome: PayoutConclusion,
  asset: Asset,
): LinkScreen<ExternalClaimAction> =>
  outcome instanceof PayoutUnavailable
    ? new LinkScreen(
        m.payout_unavailable_title(),
        m.payout_unavailable_note(),
        "done",
      )
    : outcome instanceof ExternalLinkFailed
      ? payoutFailedScreen()
      : Match.valueTags(reviewExternalResult(outcome, asset), {
          Concluded: ({ screen }) => screen,
          Field: () =>
            new LinkScreen<ExternalClaimAction>(
              m.payout_failed_title(),
              m.payout_not_sent(),
              "check",
            ),
          RetryLookup: () =>
            new LinkScreen<ExternalClaimAction>(
              m.payout_failed_title(),
              m.payout_not_sent(),
              "check",
            ),
        });
