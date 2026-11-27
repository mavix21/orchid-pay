import { useEffect, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import type {
  ConfirmReclaimOutcome,
  ReviewReclaimOutcome,
  UnclaimedFunds,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";

import { walletEffects } from "@/wallet";
import { arrivalSentence } from "@/wallet/arrival";
import { DeviceFailure, useWalletTask } from "@/send/use-wallet-task";
import { m } from "@/paraglide/messages";

type WaitingStep = Data.TaggedEnum<{
  Claiming: {};
  Stopped: { readonly problem: string };
}>;

const WaitingStep = Data.taggedEnum<WaitingStep>();

const stopped = (outcome: ConfirmReclaimOutcome | DeviceFailure) =>
  WaitingStep.Stopped({
    problem: Predicate.isTagged(outcome, "AssetPending")
      ? m.waiting_asset_pending()
      : Predicate.isTagged(outcome, "PasskeyCancelled")
        ? m.waiting_passkey_cancelled()
        : m.waiting_failed(),
  });

export function WaitingPayment({
  payment,
  onReceived,
}: {
  payment: UnclaimedFunds;
  onReceived: () => void;
}) {
  const task = useWalletTask();
  const [step, setStep] = useState<WaitingStep>(WaitingStep.Claiming());

  const settle = (outcome: ConfirmReclaimOutcome | DeviceFailure) => {
    if (
      Predicate.isTagged(outcome, "AssetSettled") ||
      Predicate.isTagged(outcome, "UnclaimedFundsGone")
    )
      onReceived();
    else setStep(stopped(outcome));
  };

  const confirm = (
    review: Extract<ReviewReclaimOutcome, { _tag: "ReclaimReview" }>,
  ) => task.run(walletEffects.confirmReclaim(review), settle);

  const claim = () => {
    setStep(WaitingStep.Claiming());
    task.run(
      walletEffects.reviewReclaim({
        unclaimedFunds: payment.id,
        asset: payment.asset,
        amount: payment.amount,
      }),
      (answer) =>
        !(answer instanceof DeviceFailure) &&
        Predicate.isTagged(answer, "ReclaimReview")
          ? confirm(answer)
          : settle(answer),
    );
  };

  useEffect(claim, [payment.id]);

  return (
    <section
      aria-labelledby="waiting-payment-title"
      data-testid="waiting-payment"
      className="flex flex-col gap-3 rounded-lg bg-muted p-4"
    >
      <h2 id="waiting-payment-title" className="text-label-lg">
        {arrivalSentence(payment)}
      </h2>
      {Match.valueTags(step, {
        Claiming: () => (
          <p role="status" className="text-body text-muted-foreground">
            {m.waiting_receiving()}
          </p>
        ),
        Stopped: ({ problem }) => (
          <>
            <p role="alert" className="text-body text-destructive">
              {problem}
            </p>
            <Button className="w-full" onClick={claim}>
              {m.receive_with_passkey()}
            </Button>
          </>
        ),
      })}
    </section>
  );
}
