import { useReducer } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";

import {
  type ConfirmReclaimOutcome,
  type ReclaimReview,
  type ReviewReclaimOutcome,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { ReviewHero } from "@/components/review-hero";
import { ScreenActions } from "@/components/screen";
import { amountLabel } from "@/send/money";
import { type Answer, useWalletTask } from "@/send/use-wallet-task";
import { walletEffects } from "@/wallet";

import {
  LinkResultScreen,
  LinkWorking,
  ResultButton,
  ResultLink,
} from "./link-result";
import {
  type ReclaimConclusion,
  type RecoverableLink,
  reclaimResult,
} from "./outcomes";

import { m } from "@/paraglide/messages";

interface ChosenLink {
  readonly link: RecoverableLink;
  readonly created: Option.Option<string>;
}

type Recovery = Data.TaggedEnum<{
  Idle: {};
  Reviewing: { readonly chosen: ChosenLink };
  Reviewed: {
    readonly chosen: ChosenLink;
    readonly review: ReclaimReview;
    readonly problem: Option.Option<string>;
  };
  Confirming: { readonly chosen: ChosenLink; readonly review: ReclaimReview };
  Recovered: {
    readonly chosen: ChosenLink;
    readonly answer: Answer<ReclaimConclusion>;
  };
}>;

const Recovery = Data.taggedEnum<Recovery>();

export type RecoveryStarted = Exclude<
  Recovery,
  Data.TaggedEnum.Value<Recovery, "Idle">
>;

type RecoveryEvent = Data.TaggedEnum<{
  ReviewStarted: { readonly chosen: ChosenLink };
  ReviewAnswered: { readonly answer: Answer<ReviewReclaimOutcome> };
  ConfirmStarted: {};
  ConfirmAnswered: { readonly answer: Answer<ConfirmReclaimOutcome> };
  Reset: {};
}>;

const RecoveryEvent = Data.taggedEnum<RecoveryEvent>();

const confirmed = (
  state: Data.TaggedEnum.Value<Recovery, "Confirming">,
  answer: Answer<ConfirmReclaimOutcome>,
): Recovery => {
  const withdrawn = (problem: string) =>
    Recovery.Reviewed({
      chosen: state.chosen,
      review: state.review,
      problem: Option.some(problem),
    });

  return Match.value(answer).pipe(
    Match.tag("ReclaimReview", (review) =>
      Recovery.Reviewed({
        chosen: state.chosen,
        review,
        problem: Option.some(m.link_reclaim_expired()),
      }),
    ),
    Match.tag("PasskeyCancelled", () =>
      withdrawn(m.link_reclaim_passkey_cancelled()),
    ),
    Match.tag("PasskeyFailed", () => withdrawn(m.passkey_failed())),
    Match.tag("WrongCredential", () => withdrawn(m.link_other_passkey())),
    Match.tag("AssertionRejected", () =>
      withdrawn(m.link_assertion_rejected()),
    ),
    Match.orElse((outcome) =>
      Recovery.Recovered({ chosen: state.chosen, answer: outcome }),
    ),
  );
};

const reduceRecovery = (state: Recovery, event: RecoveryEvent): Recovery =>
  Match.valueTags(event, {
    ReviewStarted: ({ chosen }) => Recovery.Reviewing({ chosen }),
    ReviewAnswered: ({ answer }) =>
      Predicate.isTagged(state, "Reviewing")
        ? Predicate.isTagged(answer, "ReclaimReview")
          ? Recovery.Reviewed({
              chosen: state.chosen,
              review: answer,
              problem: Option.none(),
            })
          : Recovery.Recovered({ chosen: state.chosen, answer })
        : state,
    ConfirmStarted: () =>
      Predicate.isTagged(state, "Reviewed")
        ? Recovery.Confirming({ chosen: state.chosen, review: state.review })
        : state,
    ConfirmAnswered: ({ answer }) =>
      Predicate.isTagged(state, "Confirming")
        ? confirmed(state, answer)
        : state,
    Reset: () => Recovery.Idle(),
  });

export function useRecovery() {
  const task = useWalletTask();
  const [recovery, send] = useReducer(reduceRecovery, Recovery.Idle());

  const begin = (link: RecoverableLink, created?: string) => {
    send(
      RecoveryEvent.ReviewStarted({
        chosen: { link, created: Option.fromNullishOr(created) },
      }),
    );
    task.run(walletEffects.reviewReclaim(link), (answer) =>
      send(RecoveryEvent.ReviewAnswered({ answer })),
    );
  };

  const confirm = () => {
    if (!Predicate.isTagged(recovery, "Reviewed")) return;

    send(RecoveryEvent.ConfirmStarted());
    task.run(walletEffects.confirmReclaim(recovery.review), (answer) =>
      send(RecoveryEvent.ConfirmAnswered({ answer })),
    );
  };

  const reset = () => {
    task.stop();
    send(RecoveryEvent.Reset());
  };

  const started = Match.valueTags(recovery, {
    Idle: () => Option.none<RecoveryStarted>(),
    Reviewing: (shown) => Option.some<RecoveryStarted>(shown),
    Reviewed: (shown) => Option.some<RecoveryStarted>(shown),
    Confirming: (shown) => Option.some<RecoveryStarted>(shown),
    Recovered: (shown) => Option.some<RecoveryStarted>(shown),
  });

  return { started, begin, confirm, reset };
}

export function FullValue({ children }: { children: string }) {
  return <span className="font-mono text-caption break-all">{children}</span>;
}

function ReclaimReviewScreen({
  review,
  problem,
  onConfirm,
  onCancel,
}: {
  review: ReclaimReview;
  problem: Option.Option<string>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      <main
        data-testid="reclaim-review"
        className="flex flex-1 flex-col gap-6 px-5 pt-2"
      >
        <ReviewHero
          title={m.link_reclaim_review_title()}
          amount={amountLabel(review.amount, review.asset)}
          network={review.network}
        />
        <p className="text-body text-muted-foreground">
          {m.link_reclaim_review_note()}
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
          data-testid="confirm-recover"
        >
          {m.link_recover_money()}
        </Button>
        <Button className="w-full" variant="secondary" onClick={onCancel}>
          {m.common_go_back()}
        </Button>
      </ScreenActions>
    </>
  );
}

export function RecoveryAnswer({
  recovery,
  done,
  onBegin,
  onConfirm,
  onCancel,
}: {
  recovery: RecoveryStarted;
  done: React.ReactNode;
  onBegin: (link: RecoverableLink, created?: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return Match.valueTags(recovery, {
    Reviewing: () => <LinkWorking label={m.link_reclaim_preparing()} />,
    Confirming: () => <LinkWorking label={m.link_reclaiming()} />,
    Reviewed: ({ review, problem }) => (
      <ReclaimReviewScreen
        review={review}
        problem={problem}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    ),
    Recovered: ({ chosen, answer }) => {
      const screen = reclaimResult(answer, chosen.link);

      const again = () =>
        onBegin(chosen.link, Option.getOrUndefined(chosen.created));

      return (
        <LinkResultScreen outcome={answer._tag} screen={screen}>
          {Match.value(screen.action).pipe(
            Match.when("done", () => done),
            Match.when("home", () => (
              <ResultLink link={<Link to="/home" />}>
                {m.common_back_home()}
              </ResultLink>
            )),
            Match.when("again", () => (
              <ResultButton onClick={again}>{m.common_retry()}</ResultButton>
            )),
            Match.when("check", () => (
              <ResultButton onClick={again}>
                {m.receive_check_again()}
              </ResultButton>
            )),
            Match.exhaustive,
          )}
        </LinkResultScreen>
      );
    },
  });
}
