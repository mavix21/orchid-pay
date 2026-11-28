import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon } from "lucide-react";
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
  InputGroupText,
} from "@workspace/ui/components/input-group";
import type {
  LinkCode,
  PaymentLinkOpen,
  PayoutDestination,
  PayoutQuote,
  PayoutReview,
  PayoutStep,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { OptionRow } from "@/components/option-row";
import { Screen, ScreenActions } from "@/components/screen";
import { TopNav } from "@/components/top-nav";
import {
  LinkResultScreen,
  LinkWorking,
  ResultButton,
  ResultLink,
} from "@/links/link-result";
import type { LinkScreen } from "@/links/outcomes";
import { m } from "@/paraglide/messages";
import { amountLabel } from "@/send/money";
import { ReviewRow } from "@/send/payment-review";
import { useWalletTask } from "@/send/use-wallet-task";
import { walletEffects } from "@/wallet";

import type { ExternalClaimAction } from "./external-claim-outcomes";
import { localAmountLabel } from "./payout-labels";
import {
  type PayoutMethod,
  payoutAccountLabel,
  payoutMethodOf,
  payoutMethods,
  shownAccount,
  typedAccount,
} from "./payout-methods";
import {
  type PayoutConclusion,
  payoutFailedScreen,
  payoutNotFoundScreen,
  payoutScreen,
} from "./payout-outcomes";
import { PayoutLogo, PayoutTracker, SimulationNotice } from "./payout-status";

const followInterval = 2000;

type PayoutFlowStep = Data.TaggedEnum<{
  Choosing: {};
  Form: {
    readonly method: PayoutMethod;
    readonly notice: Option.Option<string>;
  };
  Preparing: { readonly method: PayoutMethod };
  Reviewing: {
    readonly review: PayoutReview;
    readonly notice: Option.Option<string>;
  };
  Following: {
    readonly review: PayoutReview;
    readonly status: Option.Option<PayoutStep>;
    readonly confirming: boolean;
    readonly round: number;
  };
  Concluded: {
    readonly outcome: string;
    readonly screen: LinkScreen<ExternalClaimAction>;
  };
}>;

const PayoutFlowStep = Data.taggedEnum<PayoutFlowStep>();

const finished = (status: Option.Option<PayoutStep>) =>
  Option.exists(status, (found) =>
    Predicate.isTagged(found, "PayoutCompleted"),
  );

export function PayoutFlow({
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
  const [account, setAccount] = useState("");
  const [touched, setTouched] = useState(false);
  const [quote, setQuote] = useState(Option.none<PayoutQuote>());

  const [step, setStep] = useState<PayoutFlowStep>(PayoutFlowStep.Choosing());

  const requote = (fresh: PayoutQuote, destination: PayoutDestination) => {
    setQuote(Option.some(fresh));
    setStep(
      PayoutFlowStep.Form({
        method: payoutMethodOf(destination),
        notice: Option.some(m.payout_quote_changed()),
      }),
    );
  };

  const conclude = (outcome: PayoutConclusion) =>
    setStep(
      PayoutFlowStep.Concluded({
        outcome: outcome._tag,
        screen: payoutScreen(outcome, open.asset),
      }),
    );

  const choose = (method: PayoutMethod) => {
    setAccount("");
    setTouched(false);
    setStep(PayoutFlowStep.Form({ method, notice: Option.none() }));
    task.run(walletEffects.quotePayout(code, method.currency), (answer) =>
      Predicate.isTagged(answer, "PayoutQuote")
        ? setQuote(Option.some(answer))
        : conclude(answer),
    );
  };

  const chooseAgain = () => {
    task.stop();
    setStep(PayoutFlowStep.Choosing());
  };

  useEffect(() => {
    if (
      !Predicate.isTagged(step, "Following") ||
      step.confirming ||
      finished(step.status)
    )
      return;

    const { review: shown, status, round } = step;

    const next = (found: Option.Option<PayoutStep>) =>
      setStep(
        PayoutFlowStep.Following({
          review: shown,
          status: found,
          confirming: false,
          round: round + 1,
        }),
      );

    const timer = window.setTimeout(
      () =>
        task.run(walletEffects.followPayout(shown.claim.order.id), (answer) =>
          Match.value(answer).pipe(
            Match.tag("PayoutFailed", () =>
              setStep(
                PayoutFlowStep.Concluded({
                  outcome: "PayoutFailed",
                  screen: payoutFailedScreen(),
                }),
              ),
            ),
            Match.tag("PayoutNotFound", () =>
              setStep(
                PayoutFlowStep.Concluded({
                  outcome: "PayoutNotFound",
                  screen: payoutNotFoundScreen(),
                }),
              ),
            ),
            Match.tags({
              PayoutSending: (found) => next(Option.some(found)),
              PayoutProcessing: (found) => next(Option.some(found)),
              PayoutCompleted: (found) => next(Option.some(found)),
            }),
            Match.orElse(() => next(status)),
          ),
        ),
      round === 0 ? 0 : followInterval,
    );

    return () => window.clearTimeout(timer);
  }, [step]);

  const review = (
    method: PayoutMethod,
    quoted: PayoutQuote,
    destination: PayoutDestination,
  ) => {
    setStep(PayoutFlowStep.Preparing({ method }));
    task.run(walletEffects.reviewPayout(code, destination, quoted), (answer) =>
      Match.value(answer).pipe(
        Match.tag("PayoutReview", (shown) =>
          setStep(
            PayoutFlowStep.Reviewing({ review: shown, notice: Option.none() }),
          ),
        ),
        Match.tag("PayoutQuoteChanged", ({ quote: fresh }) =>
          requote(fresh, destination),
        ),
        Match.orElse(conclude),
      ),
    );
  };

  const confirm = (shown: PayoutReview) => {
    const follow = () =>
      setStep(
        PayoutFlowStep.Following({
          review: shown,
          status: Option.none(),
          confirming: false,
          round: 0,
        }),
      );

    setStep(
      PayoutFlowStep.Following({
        review: shown,
        status: Option.none(),
        confirming: true,
        round: 0,
      }),
    );
    task.run(walletEffects.confirmPayout(shown, code), (answer) =>
      Match.value(answer).pipe(
        Match.tag("PayoutReview", (fresh) =>
          setStep(
            PayoutFlowStep.Reviewing({
              review: fresh,
              notice: Option.some(m.payout_redrafted()),
            }),
          ),
        ),
        Match.tag("PayoutQuoteChanged", ({ quote: fresh }) =>
          requote(fresh, shown.destination),
        ),
        Match.tags({
          ExternalLinkSettled: follow,
          ExternalLinkPending: follow,
          Offline: follow,
          ServerUnreachable: follow,
          LedgerUnreachable: follow,
          ServiceFailed: follow,
          SessionRequired: follow,
          RateLimited: follow,
          InvalidResponse: follow,
          DeviceFailure: follow,
        }),
        Match.orElse(conclude),
      ),
    );
  };

  const sent = amountLabel(open.amount, open.asset);

  return Match.valueTags(step, {
    Choosing: () => (
      <Screen>
        <TopNav
          title={m.payout_methods_title()}
          label={m.common_back()}
          icon={<ChevronLeftIcon />}
          onClick={onBack}
        />
        <main
          className="flex flex-1 flex-col gap-6 px-5 pt-2"
          data-testid="payout-methods"
        >
          <SimulationNotice />
          <h1 className="font-display text-h1">{m.payout_methods_heading()}</h1>
          <div className="flex flex-col gap-3">
            {payoutMethods.map((method) => (
              <OptionRow
                key={method.kind}
                title={method.name}
                description={`${method.country()} · ${method.currency}`}
                media={<PayoutLogo method={method} size="tile" />}
                mediaVariant="default"
                render={
                  <button
                    type="button"
                    onClick={() => choose(method)}
                    data-testid="choose-payout-method"
                    data-method={method.kind}
                  />
                }
              />
            ))}
          </div>
        </main>
      </Screen>
    ),
    Form: ({ method, notice }) => {
      const destination = method.destination(account);

      const shownQuote = Option.filter(
        quote,
        (found) => found.local.currency === method.currency,
      );

      const showProblem =
        touched && Option.isNone(destination) && account !== "";

      const submit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setTouched(true);

        if (Option.isSome(shownQuote) && Option.isSome(destination))
          review(method, shownQuote.value, destination.value);
      };

      const field = {
        id: "payout-account",
        "data-testid": "payout-account",
        autoFocus: true,
        value: shownAccount(method.entry, account),
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          setAccount(typedAccount(method.entry, event.target.value)),
        onBlur: () => setTouched(true),
        "aria-invalid": showProblem || undefined,
        "aria-describedby": showProblem ? "payout-account-error" : undefined,
      };

      return (
        <Screen>
          <TopNav
            title={m.payout_title({ method: method.name })}
            label={m.common_back()}
            icon={<ChevronLeftIcon />}
            onClick={chooseAgain}
          />
          <form
            className="flex flex-1 flex-col"
            noValidate
            onSubmit={submit}
            data-testid="payout-form"
            data-method={method.kind}
          >
            <main className="flex flex-1 flex-col gap-8 px-5 pt-2">
              <SimulationNotice />
              <div
                className="flex flex-col items-center gap-1 text-center"
                aria-live="polite"
              >
                <p className="text-label text-muted-foreground">
                  {m.payout_you_receive()}
                </p>
                <p
                  className="font-display text-display tabular-nums"
                  data-testid="payout-quote"
                >
                  {Option.match(shownQuote, {
                    onNone: () => (
                      <span className="text-disabled-foreground">
                        {m.payout_quoting()}
                      </span>
                    ),
                    onSome: (found) => localAmountLabel(found.local),
                  })}
                </p>
                <p className="text-body text-muted-foreground">
                  {m.payout_for_amount({
                    amount: sent,
                    username: open.sender.username,
                  })}
                </p>
              </div>
              <Field>
                <FieldLabel htmlFor="payout-account">
                  {method.accountLabel()}
                </FieldLabel>
                {Match.value(method.entry).pipe(
                  Match.tag("Mobile", ({ dialCode, placeholder }) => (
                    <InputGroup>
                      <InputGroupAddon>
                        <img
                          src={method.flag}
                          alt=""
                          className="size-5 rounded-full"
                        />
                        <InputGroupText>{dialCode}</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        {...field}
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        placeholder={placeholder}
                      />
                    </InputGroup>
                  )),
                  Match.tag("Text", ({ type, placeholder }) => (
                    <Input
                      {...field}
                      type={type}
                      inputMode={type}
                      autoComplete={type === "email" ? "email" : "off"}
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder={placeholder}
                    />
                  )),
                  Match.exhaustive,
                )}
                {showProblem ? (
                  <FieldError id="payout-account-error">
                    {method.accountInvalid()}
                  </FieldError>
                ) : (
                  <FieldDescription>{method.accountHint()}</FieldDescription>
                )}
              </Field>
              {Option.isSome(notice) ? (
                <p role="alert" className="text-body text-destructive">
                  {notice.value}
                </p>
              ) : null}
            </main>
            <ScreenActions>
              <Button
                className="w-full"
                type="submit"
                data-testid="review-payout"
                disabled={
                  Option.isNone(shownQuote) || Option.isNone(destination)
                }
              >
                {m.payout_continue()}
              </Button>
            </ScreenActions>
          </form>
        </Screen>
      );
    },
    Preparing: ({ method }) => (
      <Screen>
        <div className="px-5 pt-4">
          <SimulationNotice />
        </div>
        <LinkWorking label={m.payout_preparing({ method: method.name })} />
      </Screen>
    ),
    Reviewing: ({ review: shown, notice }) => {
      const method = payoutMethodOf(shown.destination);

      return (
        <Screen>
          <TopNav
            title={m.payout_review_title()}
            label={m.common_back()}
            icon={<ChevronLeftIcon />}
            onClick={() =>
              setStep(PayoutFlowStep.Form({ method, notice: Option.none() }))
            }
          />
          <main
            className="flex flex-1 flex-col gap-6 px-5 pt-2"
            data-testid="payout-review"
          >
            <SimulationNotice />
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-label text-muted-foreground">
                {m.payout_you_receive()}
              </p>
              <p className="font-display text-display tabular-nums">
                {localAmountLabel(shown.local)}
              </p>
            </div>
            <dl
              aria-label={m.payout_review_summary({ method: method.name })}
              className="flex flex-col divide-y divide-border rounded-lg border border-border px-4"
            >
              <ReviewRow label={m.payout_review_to()}>
                <span className="inline-flex items-center gap-2">
                  <PayoutLogo method={method} />
                  {m.payout_review_account({
                    method: method.name,
                    account: payoutAccountLabel(shown.destination),
                  })}
                </span>
              </ReviewRow>
              <ReviewRow label={m.payout_review_from_link()}>
                {amountLabel(shown.claim.amount, shown.claim.asset)}
              </ReviewRow>
              <ReviewRow label={m.payout_review_fee()}>
                {m.payout_review_free()}
              </ReviewRow>
            </dl>
            <p className="text-body text-pretty text-muted-foreground">
              {m.payout_review_note()}
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
              data-testid="confirm-payout"
              onClick={() => confirm(shown)}
            >
              {m.payout_confirm({ method: method.name })}
            </Button>
          </ScreenActions>
        </Screen>
      );
    },
    Following: ({ review: shown, status }) => (
      <PayoutTracker
        local={shown.local}
        destination={shown.destination}
        status={status}
      />
    ),
    Concluded: ({ outcome, screen }) => (
      <Screen>
        <div className="px-5 pt-4">
          <SimulationNotice />
        </div>
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
