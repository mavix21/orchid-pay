import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import {
  type ExternalLinkIntent,
  type ExternalLinkReview,
  type LinkCode,
  type PaymentLinkOpen,
  forbidsMemo,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";

import { BloomHero } from "@/components/orchid-bloom";
import { ReviewHero } from "@/components/review-hero";
import { Screen, ScreenActions } from "@/components/screen";
import {
  LinkResultScreen,
  LinkWorking,
  ResultButton,
  ResultLink,
} from "@/links/link-result";
import type { LinkScreen } from "@/links/outcomes";
import { FullValue } from "@/links/recovery";
import { memoByteLimit, memoBytes } from "@/send/intent";
import { amountLabel } from "@/send/money";
import { ReviewRow } from "@/send/payment-review";
import { useWalletTask } from "@/send/use-wallet-task";
import { walletEffects } from "@/wallet";

import {
  type ExternalClaimFieldProblem,
  type ExternalClaimForm,
  externalClaimIntentOf,
} from "./external-claim-intent";
import {
  type ExternalClaimAction,
  ExternalClaimResult,
  confirmExternalResult,
  reviewExternalResult,
} from "./external-claim-outcomes";

import { m } from "@/paraglide/messages";

type ExternalStep = Data.TaggedEnum<{
  Form: {
    readonly problem: Option.Option<ExternalClaimFieldProblem>;
    readonly lookupError: Option.Option<string>;
  };
  Preparing: {};
  Reviewing: {
    readonly review: ExternalLinkReview;
    readonly notice: Option.Option<string>;
  };
  Confirming: { readonly review: ExternalLinkReview };
  Concluded: {
    readonly outcome: string;
    readonly screen: LinkScreen<ExternalClaimAction>;
  };
}>;

const ExternalStep = Data.taggedEnum<ExternalStep>();

export function ExternalClaimFlow({
  code,
  open,
  onBack,
  onRecheck,
}: {
  code: LinkCode;
  open: PaymentLinkOpen;
  onBack: () => void;
  onRecheck: () => void;
}) {
  const task = useWalletTask();
  const destinationRef = useRef<HTMLInputElement>(null);
  const memoRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<ExternalClaimForm>({
    destination: "",
    memo: "",
  });

  const [step, setStep] = useState<ExternalStep>(
    ExternalStep.Form({ problem: Option.none(), lookupError: Option.none() }),
  );

  const sent = amountLabel(open.amount, open.asset);
  const muxed = forbidsMemo(form.destination.trim());

  useEffect(() => {
    if (!Predicate.isTagged(step, "Form") || Option.isNone(step.problem))
      return;

    if (step.problem.value.field === "destination")
      destinationRef.current?.focus();
    else memoRef.current?.focus();
  }, [step]);

  const applyResult = (result: ExternalClaimResult) =>
    setStep(
      Match.valueTags(result, {
        Field: ({ problem }) =>
          ExternalStep.Form({
            problem: Option.some(problem),
            lookupError: Option.none(),
          }),
        RetryLookup: ({ message }) =>
          ExternalStep.Form({
            problem: Option.none(),
            lookupError: Option.some(message),
          }),
        Concluded: ({ outcome, screen }) =>
          ExternalStep.Concluded({ outcome, screen }),
      }),
    );

  const startReview = (intent: ExternalLinkIntent) => {
    setStep(ExternalStep.Preparing());
    task.run(walletEffects.reviewExternalLinkClaim(code, intent), (answer) => {
      if (Predicate.isTagged(answer, "ExternalLinkReview")) {
        setStep(
          ExternalStep.Reviewing({ review: answer, notice: Option.none() }),
        );

        return;
      }

      applyResult(reviewExternalResult(answer, open.asset));
    });
  };

  const submitForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    Result.match(externalClaimIntentOf(form), {
      onFailure: (problem) =>
        applyResult(ExternalClaimResult.Field({ problem })),
      onSuccess: startReview,
    });
  };

  const confirm = (shown: ExternalLinkReview) => {
    setStep(ExternalStep.Confirming({ review: shown }));
    task.run(walletEffects.confirmExternalLinkClaim(shown, code), (answer) => {
      if (Predicate.isTagged(answer, "ExternalLinkReview")) {
        setStep(
          ExternalStep.Reviewing({
            review: answer,
            notice: Option.some(m.external_redrafted()),
          }),
        );

        return;
      }

      applyResult(
        confirmExternalResult(answer, open.asset, sent, shown.destination),
      );
    });
  };

  return Match.valueTags(step, {
    Form: ({ problem, lookupError }) => {
      const destinationProblem = problem.pipe(
        Option.filter((found) => found.field === "destination"),
        Option.map((found) => found.message),
      );

      const memoProblem = problem.pipe(
        Option.filter((found) => found.field === "memo"),
        Option.map((found) => found.message),
      );

      return (
        <Screen>
          <form
            className="flex flex-1 flex-col"
            noValidate
            onSubmit={submitForm}
          >
            <main className="flex flex-1 flex-col gap-6 px-5 pt-2">
              <div className="flex flex-col gap-1">
                <h1 className="font-display text-h1">{m.external_title()}</h1>
                <p className="text-body text-muted-foreground">
                  {m.external_from({
                    amount: sent,
                    username: open.sender.username,
                  })}
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="external-destination">
                  {m.common_stellar_address()}
                </FieldLabel>
                <Input
                  id="external-destination"
                  name="destination"
                  ref={destinationRef}
                  value={form.destination}
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      destination: event.target.value,
                    }));
                    setStep(
                      ExternalStep.Form({
                        problem: Option.none(),
                        lookupError: Option.none(),
                      }),
                    );
                  }}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus={Option.isNone(memoProblem)}
                  aria-invalid={Option.isSome(destinationProblem) || undefined}
                  aria-describedby={
                    Option.isSome(destinationProblem)
                      ? "external-destination-error"
                      : undefined
                  }
                />
                <FieldDescription>{m.common_address_hint()}</FieldDescription>
                {Option.isSome(destinationProblem) ? (
                  <FieldError id="external-destination-error">
                    {destinationProblem.value}
                  </FieldError>
                ) : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="external-memo">
                  {m.external_memo_optional()}
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="external-memo"
                    name="memo"
                    ref={memoRef}
                    value={muxed ? "" : form.memo}
                    disabled={muxed}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        memo: event.target.value,
                      }));
                      setStep(
                        ExternalStep.Form({
                          problem: Option.none(),
                          lookupError: Option.none(),
                        }),
                      );
                    }}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-invalid={Option.isSome(memoProblem) || undefined}
                    aria-describedby={
                      Option.isSome(memoProblem)
                        ? "external-memo-error"
                        : undefined
                    }
                  />
                  {muxed ? null : (
                    <InputGroupAddon align="inline-end">
                      <span className="text-label tabular-nums">
                        {memoBytes(form.memo)}/{memoByteLimit}
                      </span>
                    </InputGroupAddon>
                  )}
                </InputGroup>
                <FieldDescription>
                  {muxed ? m.external_muxed_note() : m.external_memo_hint()}
                </FieldDescription>
                {Option.isSome(memoProblem) ? (
                  <FieldError id="external-memo-error">
                    {memoProblem.value}
                  </FieldError>
                ) : null}
              </Field>
              {Option.isSome(lookupError) ? (
                <p
                  role="alert"
                  data-testid="external-lookup-error"
                  className="text-body text-destructive"
                >
                  {lookupError.value}
                </p>
              ) : null}
            </main>
            <ScreenActions>
              <Button
                className="w-full"
                type="submit"
                data-testid={
                  Option.isSome(lookupError)
                    ? "retry-external-claim"
                    : "review-external-claim"
                }
              >
                {Option.isSome(lookupError)
                  ? m.common_retry()
                  : m.common_review()}
              </Button>
              <Button
                className="w-full"
                type="button"
                variant="secondary"
                data-testid="back-to-offer"
                onClick={onBack}
              >
                {m.common_go_back()}
              </Button>
            </ScreenActions>
          </form>
        </Screen>
      );
    },
    Preparing: () => (
      <Screen>
        <LinkWorking label={m.external_preparing()} />
      </Screen>
    ),
    Reviewing: ({ review: shown, notice }) => (
      <Screen>
        <main className="flex flex-1 flex-col gap-6 px-5 pt-2">
          <ReviewHero
            title={m.receive_from({ username: shown.sender.username })}
            amount={amountLabel(shown.amount, shown.asset)}
            network={shown.network}
          />
          <dl
            aria-label={m.external_summary()}
            data-testid="external-claim-review"
            className="flex flex-col divide-y divide-border rounded-lg border border-border px-4"
          >
            <ReviewRow label={m.common_to()}>
              <span className="flex flex-col items-end">
                <FullValue>{shown.destination}</FullValue>
                {shown.memoRequired ? (
                  <span className="text-caption text-muted-foreground">
                    {m.external_memo_required()}
                  </span>
                ) : null}
              </span>
            </ReviewRow>
            {shown.memo === undefined ? null : (
              <ReviewRow label={m.common_memo()}>
                <span className="break-all whitespace-pre-wrap">
                  {shown.memo.value}
                </span>
              </ReviewRow>
            )}
            <ReviewRow label={m.common_fee()}>{m.common_free()}</ReviewRow>
          </dl>
          <p className="text-body text-muted-foreground">
            {m.external_review_note()}
          </p>
          {Option.isSome(notice) ? (
            <p role="alert" className="text-body text-destructive">
              {notice.value}
            </p>
          ) : null}
        </main>
        <ScreenActions>
          <Button
            className="w-full"
            data-testid="confirm-external-claim"
            onClick={() => confirm(shown)}
          >
            {m.common_send()}
          </Button>
          <Button
            className="w-full"
            type="button"
            variant="secondary"
            data-testid="edit-external-claim"
            onClick={() =>
              setStep(
                ExternalStep.Form({
                  problem: Option.none(),
                  lookupError: Option.none(),
                }),
              )
            }
          >
            {m.common_edit()}
          </Button>
        </ScreenActions>
      </Screen>
    ),
    Confirming: () => (
      <Screen>
        <LinkWorking label={m.common_sending()} />
      </Screen>
    ),
    Concluded: ({ outcome, screen }) =>
      outcome === "ExternalLinkSettled" ? (
        <Screen>
          <main
            data-testid="link-outcome"
            data-outcome={outcome}
            className="flex flex-1 flex-col px-5"
          >
            <BloomHero motion="flourish" label={screen.title}>
              <p className="text-body text-muted-foreground">
                {screen.message}
              </p>
            </BloomHero>
          </main>
          <ScreenActions>
            <ResultLink link={<Link to="/" />}>
              {m.receive_go_start()}
            </ResultLink>
          </ScreenActions>
        </Screen>
      ) : (
        <Screen>
          <LinkResultScreen outcome={outcome} screen={screen}>
            {Match.value(screen.action).pipe(
              Match.when("check", () => (
                <ResultButton onClick={onRecheck}>
                  {m.receive_check_again()}
                </ResultButton>
              )),
              Match.when("done", () => (
                <ResultLink link={<Link to="/" />}>
                  {m.receive_go_start()}
                </ResultLink>
              )),
              Match.exhaustive,
            )}
          </LinkResultScreen>
        </Screen>
      ),
  });
}
