import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import {
  type AssetOrderId,
  type LocalAmount,
  type PayoutDestination,
  PayoutOrder,
  PayoutQuote,
  type PayoutQuoteChanged,
  type PayoutUnavailable,
  type WalletPort,
  type WalletUnavailable,
  sameAsset,
} from "../contract";
import type { ClaimIssue } from "./claim-reviews";
import { deviceExternalLinkClaim } from "./external-link-claim";
import type { LinkCode } from "./link-code";
import { OpenedLink, openLink } from "./link-receive";
import {
  type ConfirmPayoutOutcome,
  DraftRejected,
  ExternalLinkIntent,
  ExternalLinkReview,
  type FollowPayoutOutcome,
  PayoutReview,
  type QuotePayoutOutcome,
  type ReviewPayoutOutcome,
} from "./outcomes";

type PayoutPort = Pick<
  WalletPort,
  "paymentLink" | "quotePayout" | "requestPayout" | "payout"
>;

const payoutReviewJson = Schema.encodeSync(Schema.fromJsonString(PayoutReview));

export interface PayoutIssue {
  readonly claim: Ref.Ref<ClaimIssue>;
  readonly issued: Ref.Ref<Option.Option<string>>;
}

export function devicePayouts(
  port: PayoutPort,
  { claim: state, issued }: PayoutIssue,
) {
  const claimsFor = (destination: PayoutDestination, local: LocalAmount) =>
    deviceExternalLinkClaim<PayoutQuoteChanged | PayoutUnavailable>(
      {
        paymentLink: port.paymentLink,
        claimPaymentLink: (claim, approval) =>
          port.requestPayout(
            new PayoutOrder({ claim, destination, local }),
            approval,
          ),
      },
      state,
    );

  const reviewed =
    (destination: PayoutDestination, local: LocalAmount) =>
    (
      outcome: Effect.Success<
        ReturnType<ReturnType<typeof claimsFor>["review"]>
      >,
    ): Effect.Effect<ReviewPayoutOutcome> => {
      if (!(outcome instanceof ExternalLinkReview))
        return Effect.succeed(outcome);

      const review = new PayoutReview({ claim: outcome, destination, local });

      return Ref.set(issued, Option.some(payoutReviewJson(review))).pipe(
        Effect.as(review),
      );
    };

  const quote = Effect.fn("Device.quotePayout")(function* (
    code: LinkCode,
  ): Effect.fn.Return<QuotePayoutOutcome, WalletUnavailable> {
    const target = yield* openLink(port, code);

    if (!(target instanceof OpenedLink)) return target;

    const quoted = yield* port.quotePayout(target.link);

    if (!(quoted instanceof PayoutQuote)) return quoted;

    return quoted.link === target.link &&
      quoted.unclaimedFunds === target.unclaimedFunds &&
      quoted.amount === target.amount &&
      sameAsset(quoted.asset, target.asset)
      ? quoted
      : new DraftRejected();
  });

  const review = (
    code: LinkCode,
    destination: PayoutDestination,
    quoted: PayoutQuote,
  ): Effect.Effect<ReviewPayoutOutcome, WalletUnavailable> =>
    claimsFor(destination, quoted.local)
      .review(
        code,
        new ExternalLinkIntent({ destination: quoted.depositAddress }),
      )
      .pipe(Effect.flatMap(reviewed(destination, quoted.local)));

  const confirm = Effect.fn("Device.confirmPayout")(function* (
    shown: PayoutReview,
    code: LinkCode,
  ): Effect.fn.Return<ConfirmPayoutOutcome, WalletUnavailable> {
    const current = yield* Ref.getAndSet(issued, Option.none());

    if (!Option.contains(current, payoutReviewJson(shown)))
      return new DraftRejected();

    const outcome = yield* claimsFor(shown.destination, shown.local).confirm(
      shown.claim,
      code,
    );

    return yield* reviewed(shown.destination, shown.local)(outcome);
  });

  const follow = (
    id: AssetOrderId,
  ): Effect.Effect<FollowPayoutOutcome, WalletUnavailable> => port.payout(id);

  return { quote, review, confirm, follow };
}
