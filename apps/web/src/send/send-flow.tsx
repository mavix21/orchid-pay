import { useEffect, useReducer, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import type {
  Amount,
  Asset,
  PaymentReview,
  PositiveAmount,
  ResumeOutcome,
  TransferId,
  TransferIntent,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { ScreenActions, ScreenStatus } from "@/components/screen";
import { LinkFlow } from "@/links/link-flow";
import { walletEffects } from "@/wallet";

import { AmountStep } from "./amount-step";
import {
  type Choice,
  DestinationChoice,
  LinkOffer,
} from "./destination-choice";
import {
  type Destination,
  FieldProblem,
  type SendField,
  type SendForm,
} from "./intent";
import { amountLabel } from "./money";
import { SendScreen } from "./outcomes";
import {
  Answered,
  type ReviewAnswer,
  readConfirm,
  readOutcome,
  readReview,
  unreleased,
} from "./send-answers";
import { PaymentReviewCard } from "./payment-review";
import { RecipientStep } from "./recipient-step";
import { SendResultScreen } from "./send-result";
import { type Answer, useWalletTask } from "./use-wallet-task";

import { m } from "@/paraglide/messages";

type EntryField = "recipient" | "amount";

interface Entry {
  readonly destination: Destination;
  readonly form: SendForm;
  readonly problem: Option.Option<FieldProblem>;
}

interface Draft {
  readonly entry: Entry;
  readonly intent: TransferIntent;
}

type SendStep = Data.TaggedEnum<{
  Choosing: {};
  Linking: { readonly amount: Option.Option<PositiveAmount> };
  Offering: { readonly draft: Draft; readonly problem: FieldProblem };
  Entering: { readonly field: EntryField; readonly entry: Entry };
  Reviewing: { readonly draft: Draft };
  Reviewed: {
    readonly draft: Draft;
    readonly review: PaymentReview;
    readonly problem: Option.Option<string>;
  };
  Confirming: { readonly draft: Draft; readonly review: PaymentReview };
  Concluded: {
    readonly draft: Draft;
    readonly outcome: string;
    readonly screen: SendScreen;
    readonly resume: Option.Option<TransferId>;
  };
  Tracking: { readonly id: TransferId; readonly draft: Option.Option<Draft> };
}>;

const SendStep = Data.taggedEnum<SendStep>();

type SendEvent = Data.TaggedEnum<{
  Chose: { readonly choice: Choice };
  Unchose: {};
  LinkAccepted: {};
  LinkDeclined: {};
  Typed: { readonly field: SendField; readonly value: string };
  Invalid: { readonly problem: FieldProblem };
  Moved: { readonly field: EntryField };
  ReviewStarted: { readonly intent: TransferIntent };
  ReviewAnswered: { readonly answer: ReviewAnswer };
  ConfirmStarted: {};
  ConfirmAnswered: { readonly answer: Answered };
  Resumed: {};
  StartedOver: {};
}>;

const SendEvent = Data.taggedEnum<SendEvent>();

const emptyForm: SendForm = { recipient: "", amount: "", memo: "" };

const draftOf = (step: SendStep): Option.Option<Draft> =>
  Match.valueTags(step, {
    Choosing: () => Option.none(),
    Linking: () => Option.none(),
    Offering: ({ draft }) => Option.some(draft),
    Entering: () => Option.none(),
    Reviewing: ({ draft }) => Option.some(draft),
    Reviewed: ({ draft }) => Option.some(draft),
    Confirming: ({ draft }) => Option.some(draft),
    Concluded: ({ draft }) => Option.some(draft),
    Tracking: ({ draft }) => draft,
  });

const entryOf = (step: SendStep): Option.Option<Entry> =>
  Predicate.isTagged(step, "Entering")
    ? Option.some(step.entry)
    : Option.map(draftOf(step), (draft) => draft.entry);

const corrected = (entry: Entry, problem: FieldProblem) =>
  SendStep.Entering({
    field: problem.field === "recipient" ? "recipient" : "amount",
    entry: { ...entry, problem: Option.some(problem) },
  });

const editing = (
  step: SendStep,
  change: (entering: Data.TaggedEnum.Value<SendStep, "Entering">) => SendStep,
) => (Predicate.isTagged(step, "Entering") ? change(step) : step);

const reduceSendFlow = (step: SendStep, event: SendEvent): SendStep =>
  Match.valueTags(event, {
    Chose: ({ choice }) => {
      if (!Predicate.isTagged(step, "Choosing")) return step;

      return choice === "link"
        ? SendStep.Linking({ amount: Option.none() })
        : SendStep.Entering({
            field: "recipient",
            entry: {
              destination: choice,
              form: emptyForm,
              problem: Option.none(),
            },
          });
    },
    Unchose: () =>
      Predicate.isTagged(step, "Linking") ||
      (Predicate.isTagged(step, "Entering") && step.field === "recipient")
        ? SendStep.Choosing()
        : step,
    LinkAccepted: () =>
      Predicate.isTagged(step, "Offering")
        ? SendStep.Linking({ amount: Option.some(step.draft.intent.amount) })
        : step,
    LinkDeclined: () =>
      Predicate.isTagged(step, "Offering")
        ? corrected(step.draft.entry, step.problem)
        : step,
    Typed: ({ field, value }) =>
      editing(step, (entering) =>
        SendStep.Entering({
          field: entering.field,
          entry: {
            ...entering.entry,
            form: { ...entering.entry.form, [field]: value },
            problem: Option.none(),
          },
        }),
      ),
    Invalid: ({ problem }) =>
      editing(step, (entering) =>
        SendStep.Entering({
          field: entering.field,
          entry: { ...entering.entry, problem: Option.some(problem) },
        }),
      ),
    Moved: ({ field }) =>
      editing(step, (entering) =>
        SendStep.Entering({ field, entry: entering.entry }),
      ),
    ReviewStarted: ({ intent }) =>
      Option.match(entryOf(step), {
        onNone: () => step,
        onSome: (entry) =>
          SendStep.Reviewing({
            draft: { entry: { ...entry, problem: Option.none() }, intent },
          }),
      }),
    ReviewAnswered: ({ answer }) => {
      if (!Predicate.isTagged(step, "Reviewing")) return step;

      return Match.valueTags(answer, {
        Shown: ({ review }) =>
          SendStep.Reviewed({
            draft: step.draft,
            review,
            problem: Option.none(),
          }),
        Corrected: ({ problem }) => corrected(step.draft.entry, problem),
        Offered: ({ problem }) =>
          SendStep.Offering({ draft: step.draft, problem }),
        Concluded: ({ outcome, screen }) =>
          SendStep.Concluded({
            draft: step.draft,
            outcome,
            screen,
            resume: Option.none(),
          }),
      });
    },
    ConfirmStarted: () =>
      Predicate.isTagged(step, "Reviewed")
        ? SendStep.Confirming({ draft: step.draft, review: step.review })
        : step,
    ConfirmAnswered: ({ answer }) => {
      if (!Predicate.isTagged(step, "Confirming")) return step;

      return Match.valueTags(answer, {
        Shown: ({ review }) =>
          SendStep.Reviewed({
            draft: step.draft,
            review,
            problem: Option.some(m.send_redrafted()),
          }),
        Refused: ({ problem }) =>
          SendStep.Reviewed({
            draft: step.draft,
            review: step.review,
            problem: Option.some(problem),
          }),
        Corrected: ({ problem }) => corrected(step.draft.entry, problem),
        Offered: ({ problem }) =>
          SendStep.Offering({ draft: step.draft, problem }),
        Concluded: ({ outcome, screen }) =>
          SendStep.Concluded({
            draft: step.draft,
            outcome,
            screen,
            resume:
              outcome === "Pending"
                ? Option.some(step.review.order.id)
                : Option.none(),
          }),
      });
    },
    Resumed: () =>
      Predicate.isTagged(step, "Concluded") && Option.isSome(step.resume)
        ? SendStep.Tracking({
            id: step.resume.value,
            draft: Option.some(step.draft),
          })
        : step,
    StartedOver: () =>
      Option.match(draftOf(step), {
        onNone: () =>
          Predicate.isTagged(step, "Tracking") ? SendStep.Choosing() : step,
        onSome: ({ entry }) => SendStep.Entering({ field: "amount", entry }),
      }),
  });

function Working({ label }: { label: string }) {
  return <ScreenStatus title={label} />;
}

function ReviewScreen({
  review,
  problem,
  onConfirm,
  onEdit,
}: {
  review: PaymentReview;
  problem: Option.Option<string>;
  onConfirm: () => void;
  onEdit: () => void;
}) {
  return (
    <>
      <main className="flex flex-1 flex-col gap-6 px-5 pt-2">
        <h1 className="font-display text-h1">{m.send_review_title()}</h1>
        <PaymentReviewCard review={review} />
        <p className="text-body text-muted-foreground">
          {m.send_review_note()}
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
          onClick={onConfirm}
          data-testid="confirm-payment"
        >
          {m.common_send()}
        </Button>
        <Button className="w-full" variant="secondary" onClick={onEdit}>
          {m.common_edit()}
        </Button>
      </ScreenActions>
    </>
  );
}

function TransferStatus({
  id,
  asset,
  onStartOver,
}: {
  id: TransferId;
  asset: Asset;
  onStartOver: () => void;
}) {
  const task = useWalletTask();

  const [found, setFound] = useState<Option.Option<Answer<ResumeOutcome>>>(
    Option.none(),
  );

  const look = () => {
    setFound(Option.none());
    task.run(walletEffects.resume(id), (answer) =>
      setFound(Option.some(answer)),
    );
  };

  useEffect(look, [id]);

  if (Option.isNone(found)) return <Working label={m.send_looking()} />;

  const answer = readOutcome(found.value, asset);

  return Match.valueTags(answer, {
    Corrected: ({ outcome, problem }) => (
      <SendResultScreen
        outcome={outcome}
        screen={
          new SendScreen(m.send_check_details(), problem.message, "retry")
        }
        onAgain={onStartOver}
      />
    ),
    Concluded: ({ outcome, screen }) => (
      <SendResultScreen
        outcome={outcome}
        screen={screen}
        onAgain={outcome === "Failed" ? onStartOver : look}
      />
    ),
  });
}

export function SendFlow({
  asset,
  available,
  transfer,
  nav,
  onTransfer,
}: {
  asset: Asset;
  available: Amount;
  transfer: Option.Option<TransferId>;
  nav: (locked: boolean, edit?: () => void) => React.ReactNode;
  onTransfer: (id: Option.Option<TransferId>) => void;
}) {
  const task = useWalletTask();

  const [step, send] = useReducer(
    reduceSendFlow,
    transfer,
    Option.match({
      onNone: () => SendStep.Choosing(),
      onSome: (id) => SendStep.Tracking({ id, draft: Option.none() }),
    }),
  );

  const startOver = () => {
    task.stop();
    onTransfer(Option.none());
    send(SendEvent.StartedOver());
  };

  const review = (intent: TransferIntent) => {
    onTransfer(Option.none());
    send(SendEvent.ReviewStarted({ intent }));
    task.run(walletEffects.review(intent), (answer) =>
      send(SendEvent.ReviewAnswered({ answer: readReview(answer, asset) })),
    );
  };

  const confirm = (shown: PaymentReview) => {
    onTransfer(Option.some(shown.order.id));
    send(SendEvent.ConfirmStarted());
    task.run(walletEffects.confirm(shown), (answered) => {
      const answer = readConfirm(answered, asset);

      if (
        Predicate.isTagged(answer, "Corrected") ||
        Predicate.isTagged(answer, "Offered") ||
        unreleased.has(answered._tag)
      )
        onTransfer(Option.none());

      send(SendEvent.ConfirmAnswered({ answer }));
    });
  };

  const edit = (field: SendField, value: string) =>
    send(SendEvent.Typed({ field, value }));

  const problem = (found: FieldProblem) =>
    send(SendEvent.Invalid({ problem: found }));

  const withNav = (screen: React.ReactNode) => (
    <>
      {nav(false)}
      {screen}
    </>
  );

  return Match.valueTags(step, {
    Linking: ({ amount }) => (
      <LinkFlow
        asset={asset}
        available={available}
        initialAmount={amount}
        nav={nav}
        onChangeDestination={() => send(SendEvent.Unchose())}
      />
    ),
    Choosing: () =>
      withNav(
        <DestinationChoice
          onChoose={(choice) => send(SendEvent.Chose({ choice }))}
        />,
      ),
    Offering: ({ draft, problem }) =>
      withNav(
        <LinkOffer
          problem={problem}
          amount={amountLabel(draft.intent.amount, asset)}
          onAccept={() => send(SendEvent.LinkAccepted())}
          onDecline={() => send(SendEvent.LinkDeclined())}
        />,
      ),
    Entering: ({ field, entry }) =>
      withNav(
        field === "recipient" ? (
          <RecipientStep
            destination={entry.destination}
            recipient={entry.form.recipient}
            problem={entry.problem}
            onEdit={(recipient) => edit("recipient", recipient)}
            onContinue={() => send(SendEvent.Moved({ field: "amount" }))}
            onProblem={problem}
            onChangeDestination={() => send(SendEvent.Unchose())}
          />
        ) : (
          <AmountStep
            destination={entry.destination}
            form={entry.form}
            problem={entry.problem}
            asset={asset}
            available={available}
            onEdit={edit}
            onIntent={review}
            onProblem={problem}
            onChangeRecipient={() =>
              send(SendEvent.Moved({ field: "recipient" }))
            }
          />
        ),
      ),
    Reviewing: () => withNav(<Working label={m.send_preparing()} />),
    Reviewed: ({ review: shown, problem: refusal }) =>
      withNav(
        <ReviewScreen
          review={shown}
          problem={refusal}
          onConfirm={() => confirm(shown)}
          onEdit={startOver}
        />,
      ),
    Confirming: () => withNav(<Working label={m.common_sending()} />),
    Concluded: ({ draft, outcome, screen, resume }) =>
      withNav(
        <SendResultScreen
          outcome={outcome}
          screen={screen}
          onAgain={() =>
            Option.isSome(resume)
              ? send(SendEvent.Resumed())
              : review(draft.intent)
          }
        />,
      ),
    Tracking: ({ id }) =>
      withNav(<TransferStatus id={id} asset={asset} onStartOver={startOver} />),
  });
}
