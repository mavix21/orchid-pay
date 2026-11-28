import type { PaymentReview } from "@workspace/wallet";
import { formatAmount, precisionOf } from "@workspace/wallet";

import { shortAddress } from "./money";

import { m } from "@/paraglide/messages";

export function ReviewRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="shrink-0 text-body text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-label-lg">{children}</dd>
    </div>
  );
}

export function PaymentReviewCard({ review }: { review: PaymentReview }) {
  const address = shortAddress(review.to);
  const asset = review.asset.code;
  const amount = formatAmount(review.amount, precisionOf(review.asset));

  return (
    <div className="flex flex-col gap-4">
      <dl
        aria-label={m.send_review_summary()}
        className="flex flex-col divide-y divide-border rounded-lg border border-border px-4"
        data-testid="payment-summary"
        data-username={review.username}
        data-asset={asset}
        data-amount={amount}
      >
        <ReviewRow label={m.common_to()}>
          {review.username === undefined ? (
            <span className="flex flex-col items-end">
              <span>{address}</span>
            </span>
          ) : (
            <span className="flex flex-col items-end">
              <span>@{review.username}</span>
              <span className="text-caption text-muted-foreground">
                {address}
              </span>
            </span>
          )}
        </ReviewRow>
        <ReviewRow label={m.send_asset()}>{asset}</ReviewRow>
        <ReviewRow label={m.send_amount()}>{amount}</ReviewRow>
        {review.memo === undefined ? null : (
          <ReviewRow label={m.common_memo()}>
            <span className="break-all whitespace-pre-wrap">
              {review.memo.value}
            </span>
          </ReviewRow>
        )}
        <ReviewRow label={m.common_fee()}>{m.send_fee_paid()}</ReviewRow>
      </dl>
    </div>
  );
}
