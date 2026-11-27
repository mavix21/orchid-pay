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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@workspace/ui/components/input-group";
import {
  type LinkCode,
  type PaymentLinkOpen,
  PeruvianMobile,
  type PayoutQuote,
  type PayoutReview,
  type PayoutStep,
  YapeAccount,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

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
import { localAmountLabel, mobileDigits, mobileLabel } from "./payout-labels";
import {
  type PayoutConclusion,
  payoutFailedScreen,
  payoutNotFoundScreen,
  payoutScreen,
} from "./payout-outcomes";
import { PayoutTracker, SimulationNotice } from "./payout-status";

const followInterval = 2000;

type PayoutFlowStep = Data.TaggedEnum<{
  Form: { readonly notice: Option.Option<string> };
  Preparing: {};
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
  const [mobile, setMobile] = useState("");
  const [touched, setTouched] = useState(false);
  const [quote, setQuote] = useState(Option.none<PayoutQuote>());

  const [step, setStep] = useState<PayoutFlowStep>(
    PayoutFlowStep.Form({ notice: Option.none() }),
  );

  const requote = (fresh: PayoutQuote) => {
    setQuote(Option.some(fresh));
    setStep(
      PayoutFlowStep.Form({ notice: Option.some(m.payout_quote_changed()) }),
    );
  };

  const conclude = (outcome: PayoutConclusion) =>
    setStep(
      PayoutFlowStep.Concluded({
        outcome: outcome._tag,
        screen: payoutScreen(outcome, open.asset),
      }),
    );

  useEffect(() => {
    task.run(walletEffects.quotePayout(code), (answer) =>
      Predicate.isTagged(answer, "PayoutQuote")
        ? setQuote(Option.some(answer))
        : conclude(answer),
    );
  }, []);

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

  const review = (quoted: PayoutQuote, typed: PeruvianMobile) => {
    const destination = YapeAccount.make({ mobile: typed });

    setStep(PayoutFlowStep.Preparing());
    task.run(walletEffects.reviewPayout(code, destination, quoted), (answer) =>
      Match.value(answer).pipe(
        Match.tag("PayoutReview", (shown) =>
          setStep(
            PayoutFlowStep.Reviewing({ review: shown, notice: Option.none() }),
          ),
        ),
        Match.tag("PayoutQuoteChanged", ({ quote: fresh }) => requote(fresh)),
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
        Match.tag("PayoutQuoteChanged", ({ quote: fresh }) => requote(fresh)),
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
  const parsed = Schema.decodeOption(PeruvianMobile)(mobile);

  return Match.valueTags(step, {
    Form: ({ notice }) => {
      const showProblem = touched && Option.isNone(parsed) && mobile !== "";

      const submit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setTouched(true);

        if (Option.isSome(quote) && Option.isSome(parsed))
          review(quote.value, parsed.value);
      };

      return (
        <Screen>
          <TopNav
            title={m.payout_title()}
            label={m.common_back()}
            icon={<ChevronLeftIcon />}
            onClick={onBack}
          />
          <form
            className="flex flex-1 flex-col"
            noValidate
            onSubmit={submit}
            data-testid="payout-form"
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
                  {Option.match(quote, {
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
                <FieldLabel htmlFor="payout-mobile">
                  {m.payout_mobile_label()}
                </FieldLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <img
                      src="/cash-out/flags/pe.svg"
                      alt=""
                      className="size-5 rounded-full"
                    />
                    <InputGroupText>+51</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="payout-mobile"
                    data-testid="payout-mobile"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    autoFocus
                    placeholder="987 654 321"
                    value={mobileLabel(mobile)}
                    onChange={(event) =>
                      setMobile(mobileDigits(event.target.value))
                    }
                    onBlur={() => setTouched(true)}
                    aria-invalid={showProblem || undefined}
                    aria-describedby={
                      showProblem ? "payout-mobile-error" : undefined
                    }
                  />
                </InputGroup>
                {showProblem ? (
                  <FieldError id="payout-mobile-error">
                    {m.payout_mobile_invalid()}
                  </FieldError>
                ) : (
                  <FieldDescription>{m.payout_mobile_hint()}</FieldDescription>
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
                disabled={Option.isNone(quote) || Option.isNone(parsed)}
              >
                {m.payout_continue()}
              </Button>
            </ScreenActions>
          </form>
        </Screen>
      );
    },
    Preparing: () => (
      <Screen>
        <div className="px-5 pt-4">
          <SimulationNotice />
        </div>
        <LinkWorking label={m.payout_preparing()} />
      </Screen>
    ),
    Reviewing: ({ review: shown, notice }) => (
      <Screen>
        <TopNav
          title={m.payout_review_title()}
          label={m.common_back()}
          icon={<ChevronLeftIcon />}
          onClick={() =>
            setStep(PayoutFlowStep.Form({ notice: Option.none() }))
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
            aria-label={m.payout_review_summary()}
            className="flex flex-col divide-y divide-border rounded-lg border border-border px-4"
          >
            <ReviewRow label={m.payout_review_to()}>
              <span className="inline-flex items-center gap-2">
                <img
                  src="/cash-out/logos/yape.png"
                  alt=""
                  className="size-5 rounded-sm"
                />
                {m.payout_review_yape_mobile({
                  mobile: mobileLabel(shown.destination.mobile),
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
            {m.payout_confirm()}
          </Button>
        </ScreenActions>
      </Screen>
    ),
    Following: ({ review: shown, status }) => (
      <PayoutTracker
        local={shown.local}
        mobile={shown.destination.mobile}
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
