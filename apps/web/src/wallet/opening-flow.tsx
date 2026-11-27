import { useEffect, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import type {
  ConfirmOpeningOutcome,
  OpeningReview,
  WalletUnavailable,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import { OrchidPending } from "@/components/orchid-pending";
import { ScreenActions, ScreenNote, ScreenStatus } from "@/components/screen";
import { walletEffects } from "@/wallet";
import { retryable, unavailableMessage } from "@/wallet/unavailable";
import {
  type Answer,
  DeviceFailure,
  useWalletTask,
} from "@/send/use-wallet-task";
import { m } from "@/paraglide/messages";

type OpeningStep = Data.TaggedEnum<{
  Preparing: {};
  Shown: {
    readonly review: OpeningReview;
    readonly problem: Option.Option<string>;
  };
  Confirming: {};
  Concluded: {
    readonly title: string;
    readonly message: string;
    readonly retry: Option.Option<string>;
  };
}>;

const OpeningStep = Data.taggedEnum<OpeningStep>();

export interface OpeningCopy {
  readonly preparing: string;
  readonly confirming: string;
  readonly title: string;
  readonly explanation: string;
  readonly action: string;
}

const reopeningCopy = (): OpeningCopy => ({
  preparing: m.account_preparing(),
  confirming: m.opening_confirming(),
  title: m.opening_title(),
  explanation: m.opening_explanation(),
  action: m.opening_action(),
});

const concluded = (title: string, message: string, retry?: string) =>
  OpeningStep.Concluded({ title, message, retry: Option.fromNullishOr(retry) });

const reasonToRetry = (problem: string, review: OpeningReview) =>
  OpeningStep.Shown({ review, problem: Option.some(problem) });

const readAnswer = (
  answer: Answer<ConfirmOpeningOutcome>,
  previous: Option.Option<OpeningReview>,
  onOpened: () => void,
): OpeningStep =>
  answer instanceof DeviceFailure
    ? concluded(
        m.opening_failed_title(),
        m.opening_device_failed(),
        m.common_retry(),
      )
    : readOutcome(answer, previous, onOpened);

const readOutcome = (
  answer: ConfirmOpeningOutcome,
  previous: Option.Option<OpeningReview>,
  onOpened: () => void,
): OpeningStep => {
  const refused = (problem: string) =>
    Option.match(previous, {
      onNone: () =>
        concluded(m.opening_failed_title(), problem, m.common_retry()),
      onSome: (review) => reasonToRetry(problem, review),
    });

  const unavailable = (failure: WalletUnavailable) =>
    concluded(
      m.opening_failed_title(),
      unavailableMessage(failure),
      retryable(failure) ? m.common_retry() : undefined,
    );

  const unsupported = () =>
    concluded(m.opening_failed_title(), m.opening_unsupported());

  return Match.valueTags(answer, {
    OpeningReview: (review) =>
      OpeningStep.Shown({
        review,
        problem:
          Option.isSome(previous) && review.redrafted
            ? Option.some(m.opening_redrafted())
            : Option.none(),
      }),
    Opened: () => {
      onOpened();

      return OpeningStep.Preparing();
    },
    OpeningPending: () =>
      concluded(
        m.opening_pending_title(),
        m.opening_pending_note(),
        m.common_refresh(),
      ),
    PasskeyCancelled: () => refused(m.opening_passkey_cancelled()),
    PasskeyFailed: () => refused(m.passkey_failed()),
    HumanCheckRefused: () =>
      concluded(
        m.opening_failed_title(),
        m.human_check_refused(),
        m.common_retry(),
      ),
    WrongCredential: () => refused(m.opening_wrong_credential()),
    AssertionRejected: () => refused(m.opening_assertion_rejected()),
    PrfOutputMissing: () =>
      concluded(m.opening_prf_missing_title(), m.opening_prf_missing()),
    CorruptDeviceWallet: () =>
      concluded(m.opening_corrupt_title(), m.opening_corrupt()),
    DraftRejected: () =>
      concluded(
        m.opening_draft_rejected_title(),
        m.opening_draft_rejected(),
        m.common_retry(),
      ),
    UsernameTaken: ({ username }) =>
      concluded(
        m.opening_username_taken_title({ username }),
        m.opening_username_taken(),
      ),
    AddressBound: ({ profile }) =>
      concluded(
        m.opening_address_bound_title({ username: profile.username }),
        m.opening_address_bound(),
        m.common_retry(),
      ),
    NotSponsored: () =>
      concluded(m.opening_not_sponsored_title(), m.opening_not_sponsored()),
    InvalidAddress: () =>
      concluded(m.opening_invalid_address_title(), m.opening_invalid_address()),
    NoWallet: () =>
      concluded(m.opening_no_wallet_title(), m.opening_no_wallet()),
    UnsupportedDevice: () =>
      concluded(m.opening_corrupt_title(), m.device_cannot_read_key()),
    InvalidUsername: () =>
      concluded(m.opening_invalid_username_title(), m.username_allowed()),
    BackupUnsupported: unsupported,
    ChallengeRefused: unsupported,
    RegistrationRefused: unsupported,
    Offline: unavailable,
    ServerUnreachable: unavailable,
    LedgerUnreachable: unavailable,
    ServiceFailed: unavailable,
    SessionRequired: unavailable,
    RateLimited: unavailable,
    InvalidResponse: unavailable,
  });
};

function OpeningReviewScreen({
  review,
  problem,
  copy,
  onConfirm,
}: {
  review: OpeningReview;
  problem: Option.Option<string>;
  copy: OpeningCopy;
  onConfirm: () => void;
}) {
  return (
    <>
      <main className="flex flex-1 flex-col gap-6 px-5 pt-2">
        <h1 className="font-display text-h1">{copy.title}</h1>
        <p className="text-label-lg" data-testid="opening-username">
          @{review.username}
        </p>
        <p className="text-body text-muted-foreground">{copy.explanation}</p>
        {Option.isSome(problem) ? (
          <p role="alert" className="text-body text-destructive">
            {problem.value}
          </p>
        ) : null}
      </main>
      <ScreenActions>
        <Button
          className="w-full"
          onClick={onConfirm}
          data-testid="confirm-opening"
        >
          {copy.action}
        </Button>
      </ScreenActions>
    </>
  );
}

export function OpeningFlow({
  username,
  onOpened,
  copy = reopeningCopy(),
}: {
  username: string;
  onOpened: () => void;
  copy?: OpeningCopy;
}) {
  const task = useWalletTask();
  const [step, setStep] = useState<OpeningStep>(OpeningStep.Preparing());

  const confirm = (shown: OpeningReview) => {
    setStep(OpeningStep.Confirming());
    task.run(walletEffects.confirmOpening(shown), (answer) =>
      setStep(readAnswer(answer, Option.some(shown), onOpened)),
    );
  };

  const look = () => {
    setStep(OpeningStep.Preparing());
    task.run(walletEffects.reviewOpening(username), (answer) =>
      setStep(readAnswer(answer, Option.none(), onOpened)),
    );
  };

  useEffect(look, [username]);

  return Match.valueTags(step, {
    Preparing: () => <OrchidPending title={copy.preparing} />,
    Confirming: () => (
      <OrchidPending title={copy.confirming} note={m.account_takes_seconds()} />
    ),
    Shown: ({ review, problem }) => (
      <OpeningReviewScreen
        review={review}
        problem={problem}
        copy={copy}
        onConfirm={() => confirm(review)}
      />
    ),
    Concluded: ({ title, message, retry }) => (
      <>
        <ScreenStatus title={title}>
          <ScreenNote>{message}</ScreenNote>
        </ScreenStatus>
        {Option.isSome(retry) ? (
          <ScreenActions>
            <Button className="w-full" onClick={look}>
              {retry.value}
            </Button>
          </ScreenActions>
        ) : null}
      </>
    ),
  });
}
