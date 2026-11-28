import { ChevronLeftIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  PayPaymentRequestRefusal,
  type PaymentRequestOpen,
  type PaymentReview,
  type TransferId,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import {
  Screen,
  ScreenActions,
  ScreenNote,
  ScreenStatus,
} from "@/components/screen";
import { TopNav } from "@/components/top-nav";
import { SendScreen, deviceFailure } from "@/send/outcomes";
import { PaymentReviewCard } from "@/send/payment-review";
import {
  Answered,
  readConfirm,
  readOutcome,
  readReview,
} from "@/send/send-answers";
import { SendResultScreen } from "@/send/send-result";
import { DeviceFailure, useWalletTask } from "@/send/use-wallet-task";
import { walletEffects } from "@/wallet";
import { enrollmentEffects } from "@/wallet/enrollment";
import { EnrollmentFlow } from "@/wallet/enrollment-flow";
import { requestPaymentEffects } from "@/wallet/payment-requests";
import { RestoreFlow } from "@/wallet/restore-flow";
import { SessionConfirmation } from "@/wallet/session-confirmation";
import { m } from "@/paraglide/messages";

type PayStep = Data.TaggedEnum<{
  Preparing: {};
  Choosing: {};
  Creating: {};
  SigningIn: {};
  SessionNeeded: { readonly retry: () => void };
  Reviewed: {
    readonly review: PaymentReview;
    readonly problem: Option.Option<string>;
  };
  Confirming: {};
  Following: {};
  Concluded: {
    readonly outcome: string;
    readonly screen: SendScreen;
    readonly pending: Option.Option<TransferId>;
  };
}>;

const PayStep = Data.taggedEnum<PayStep>();

const isRequestRefusal = Schema.is(PayPaymentRequestRefusal);

const concluded = (
  outcome: string,
  screen: SendScreen,
  pending: Option.Option<TransferId> = Option.none(),
) => PayStep.Concluded({ outcome, screen, pending });

const refusedWith = (
  outcome: string,
  message: string,
  action: "retry" | "home",
) =>
  concluded(
    outcome,
    new SendScreen(m.pay_request_refused_title(), message, action),
  );

export function PayRequest({
  request,
  onBack,
  onPaid,
}: {
  request: PaymentRequestOpen;
  onBack: () => void;
  onPaid: () => void;
}) {
  const router = useRouter();
  const { walletClient } = useRouteContext({ from: "__root__" });
  const task = useWalletTask();
  const [step, setStep] = useState<PayStep>(PayStep.Preparing());
  const { asset } = request;

  const reloadThen = (then: () => void) => {
    setStep(PayStep.Following());
    void router.invalidate().finally(then);
  };

  const reload = () => reloadThen(onBack);

  const paid = () => reloadThen(onPaid);

  const refuse = (refusal: PayPaymentRequestRefusal) =>
    Match.valueTags(refusal, {
      PaymentRequestPaid: reload,
      PaymentRequestCancelled: reload,
      PaymentRequestNotFound: reload,
      PaymentRequestBeingPaid: ({ _tag }) =>
        setStep(refusedWith(_tag, m.pay_request_being_paid(), "retry")),
      PaymentRequestSelfPay: ({ _tag }) =>
        setStep(refusedWith(_tag, m.pay_request_self(), "home")),
      PaymentRequestRequesterUnavailable: ({ _tag }) =>
        setStep(
          refusedWith(
            _tag,
            m.pay_request_requester_unavailable({
              username: request.requester,
            }),
            "retry",
          ),
        ),
      PaymentRequestPaymentTaken: ({ _tag }) =>
        setStep(refusedWith(_tag, m.pay_request_payment_taken(), "home")),
    });

  const show = (answered: Answered, pending: Option.Option<TransferId>) =>
    Match.valueTags(answered, {
      Shown: ({ review }) =>
        setStep(PayStep.Reviewed({ review, problem: Option.none() })),
      Refused: ({ problem }) =>
        setStep(refusedWith("Refused", problem, "retry")),
      Corrected: ({ outcome, problem }) =>
        setStep(refusedWith(outcome, problem.message, "retry")),
      Offered: ({ problem }) =>
        setStep(
          refusedWith("RecipientCannotReceive", problem.message, "retry"),
        ),
      Concluded: ({ outcome, screen }) =>
        setStep(concluded(outcome, screen, pending)),
    });

  const follow = (id: TransferId) => {
    setStep(PayStep.Following());
    task.run(requestPaymentEffects.resume(request.id, id), (answer) => {
      if (answer instanceof DeviceFailure)
        return setStep(concluded(answer._tag, deviceFailure()));

      if (isRequestRefusal(answer)) return refuse(answer);

      if (Predicate.isTagged(answer, "SessionRequired"))
        return setStep(PayStep.SessionNeeded({ retry: () => follow(id) }));

      if (Predicate.isTagged(answer, "Settled")) return paid();

      return show(
        readOutcome(answer, asset),
        Predicate.isTagged(answer, "Pending") ? Option.some(id) : Option.none(),
      );
    });
  };

  const review = () => {
    setStep(PayStep.Preparing());
    task.run(requestPaymentEffects.review(request), (answer) => {
      if (answer instanceof DeviceFailure)
        return setStep(concluded(answer._tag, deviceFailure()));

      if (isRequestRefusal(answer)) return refuse(answer);

      if (Predicate.isTagged(answer, "SessionRequired"))
        return setStep(PayStep.SessionNeeded({ retry: review }));

      if (Predicate.isTagged(answer, "Settled")) return paid();

      return show(
        readReview(answer, asset),
        Predicate.isTagged(answer, "Pending")
          ? Option.some(answer.id)
          : Option.none(),
      );
    });
  };

  const confirm = (shown: PaymentReview) => {
    setStep(PayStep.Confirming());
    task.run(requestPaymentEffects.confirm(request.id, shown), (answer) => {
      if (answer instanceof DeviceFailure)
        return setStep(concluded(answer._tag, deviceFailure()));

      if (isRequestRefusal(answer)) return refuse(answer);

      if (Predicate.isTagged(answer, "SessionRequired"))
        return setStep(PayStep.SessionNeeded({ retry: review }));

      if (Predicate.isTagged(answer, "Settled")) return paid();

      const answered = readConfirm(answer, asset);

      if (Predicate.isTagged(answered, "Shown"))
        return setStep(
          PayStep.Reviewed({
            review: answered.review,
            problem: Option.some(m.pay_request_redrafted()),
          }),
        );

      if (Predicate.isTagged(answered, "Refused"))
        return setStep(
          PayStep.Reviewed({
            review: shown,
            problem: Option.some(answered.problem),
          }),
        );

      return show(
        answered,
        Predicate.isTagged(answer, "Pending")
          ? Option.some(shown.order.id)
          : Option.none(),
      );
    });
  };

  const begin = () => {
    setStep(PayStep.Preparing());
    task.run(
      Effect.all([walletEffects.saved(), enrollmentEffects.pending()]),
      (answer) => {
        if (answer instanceof DeviceFailure)
          return setStep(concluded(answer._tag, deviceFailure()));

        const [saved, enrolling] = answer;

        if (Option.isSome(enrolling)) return setStep(PayStep.Creating());

        if (Predicate.isTagged(saved, "SavedWallet")) return review();

        if (Predicate.isTagged(saved, "NoWallet"))
          return setStep(PayStep.Choosing());

        return show(readOutcome(saved, asset), Option.none());
      },
    );
  };

  useEffect(begin, []);

  const framed = (locked: boolean, content: React.ReactNode) => (
    <Screen>
      <TopNav
        title={m.pay_request_nav_title()}
        label={m.common_back()}
        icon={<ChevronLeftIcon absoluteStrokeWidth />}
        disabled={locked}
        onClick={onBack}
      />
      {content}
    </Screen>
  );

  const working = (title: string) => <ScreenStatus title={title} />;

  return Match.valueTags(step, {
    Preparing: () => framed(false, working(m.pay_request_preparing())),
    Choosing: () =>
      framed(
        false,
        <>
          <ScreenStatus title={m.pay_request_choose_title()}>
            <ScreenNote>{m.pay_request_choose_note()}</ScreenNote>
          </ScreenStatus>
          <ScreenActions>
            <Button
              className="w-full"
              data-testid="pay-create-account"
              onClick={() => setStep(PayStep.Creating())}
            >
              {m.pay_request_create_account()}
            </Button>
            <Button
              className="w-full"
              variant="secondary"
              data-testid="pay-sign-in"
              onClick={() => setStep(PayStep.SigningIn())}
            >
              {m.pay_request_sign_in()}
            </Button>
          </ScreenActions>
        </>,
      ),
    Creating: () => (
      <EnrollmentFlow
        title={m.enrollment_title()}
        back={() => ({ onClick: onBack })}
        walletClient={walletClient}
        onEnrolled={review}
        onOpened={review}
        onRestore={() => setStep(PayStep.SigningIn())}
      />
    ),
    SigningIn: () => (
      <RestoreFlow
        walletClient={walletClient}
        back={{ onClick: onBack }}
        onRestored={review}
      />
    ),
    SessionNeeded: ({ retry }) =>
      framed(
        false,
        <>
          {working(m.pay_request_preparing())}
          <SessionConfirmation client={walletClient} onConfirmed={retry} />
        </>,
      ),
    Reviewed: ({ review: shown, problem }) =>
      framed(
        false,
        <>
          <main className="flex flex-1 flex-col gap-6 px-5 pt-2">
            <h1 className="font-display text-h1">
              {m.pay_request_review_title()}
            </h1>
            <PaymentReviewCard review={shown} />
            <p className="text-body text-muted-foreground">
              {m.pay_request_review_note()}
            </p>
            {Option.isSome(problem) ? (
              <p role="alert" className="text-body text-destructive">
                {problem.value}
              </p>
            ) : null}
          </main>
          <ScreenActions>
            <Button
              className="w-full"
              data-testid="confirm-payment"
              onClick={() => confirm(shown)}
            >
              {m.pay_request_confirm()}
            </Button>
          </ScreenActions>
        </>,
      ),
    Confirming: () => framed(true, working(m.pay_request_paying())),
    Following: () => framed(false, working(m.pay_request_following())),
    Concluded: ({ outcome, screen, pending }) =>
      framed(
        false,
        <SendResultScreen
          outcome={outcome}
          screen={screen}
          onAgain={() =>
            Option.isSome(pending) ? follow(pending.value) : review()
          }
        />,
      ),
  });
}
