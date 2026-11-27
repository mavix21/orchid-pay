import type {
  ConfirmPaymentLinkOutcome,
  PaymentLinkIntent,
  ResolvePaymentLinkOutcome,
  ReviewPaymentLinkOutcome,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import type { Answer } from "@/send/use-wallet-task";

import {
  LinkStep,
  concealedStep,
  delivered,
  entering,
  lost,
  nextDelivery,
  saved,
} from "./link-step";
import type { ShareResult } from "./share-link";

import { m } from "@/paraglide/messages";

export interface LinkFlowState {
  readonly amount: string;
  readonly step: LinkStep;
}

export type LinkEvent = Data.TaggedEnum<{
  Typed: { readonly amount: string };
  Invalid: { readonly problem: string };
  ReviewStarted: { readonly intent: PaymentLinkIntent };
  ReviewAnswered: { readonly answer: Answer<ReviewPaymentLinkOutcome> };
  Edited: {};
  CreateStarted: {};
  CreateAnswered: { readonly answer: Answer<ConfirmPaymentLinkOutcome> };
  ShareStarted: {};
  ShareEnded: { readonly result: ShareResult; readonly pageHidden: boolean };
  Concealed: { readonly unloading: boolean };
  Left: {};
  CheckStarted: {};
  CheckAnswered: { readonly answer: Answer<ResolvePaymentLinkOutcome> };
}>;

export const LinkEvent = Data.taggedEnum<LinkEvent>();

const afterCreate = (
  step: Data.TaggedEnum.Value<LinkStep, "Creating">,
  answer: Answer<ConfirmPaymentLinkOutcome>,
): LinkStep => {
  const withheld = (problem: string) =>
    LinkStep.Reviewed({
      intent: step.intent,
      review: step.review,
      problem: Option.some(problem),
    });

  return Match.value(answer).pipe(
    Match.tag("PaymentLinkCreated", (link) =>
      LinkStep.Created({ link, delivery: "none" }),
    ),
    Match.tag("PaymentReview", (review) =>
      LinkStep.Reviewed({
        intent: step.intent,
        review,
        problem: Option.some(m.link_expired()),
      }),
    ),
    Match.tag("PasskeyCancelled", () =>
      withheld(m.link_create_passkey_cancelled()),
    ),
    Match.tag("PasskeyFailed", () => withheld(m.passkey_failed())),
    Match.tag("WrongCredential", () => withheld(m.link_other_passkey())),
    Match.tag("AssertionRejected", () => withheld(m.link_assertion_rejected())),
    Match.orElse((outcome) =>
      LinkStep.Refused({ intent: step.intent, confirmed: true, outcome }),
    ),
  );
};

const withoutCode = (step: LinkStep) =>
  Option.getOrElse(concealedStep(step), () => step);

export const reduceLinkFlow = (
  state: LinkFlowState,
  event: LinkEvent,
): LinkFlowState => {
  const { step } = state;
  const to = (next: LinkStep): LinkFlowState => ({ ...state, step: next });

  return Match.valueTags(event, {
    Typed: ({ amount }) =>
      Predicate.isTagged(step, "Entering")
        ? { amount, step: entering() }
        : state,
    Invalid: ({ problem }) =>
      Predicate.isTagged(step, "Entering")
        ? to(entering(Option.some(problem)))
        : state,
    ReviewStarted: ({ intent }) => {
      if (Predicate.isTagged(step, "Reviewed"))
        return to(LinkStep.Renewing({ intent, review: step.review }));

      return Predicate.isTagged(step, "Entering") ||
        Predicate.isTagged(step, "Refused")
        ? to(LinkStep.Reviewing({ intent }))
        : state;
    },
    ReviewAnswered: ({ answer }) => {
      if (
        !Predicate.isTagged(step, "Reviewing") &&
        !Predicate.isTagged(step, "Renewing")
      )
        return state;

      return to(
        Predicate.isTagged(answer, "PaymentReview")
          ? LinkStep.Reviewed({
              intent: step.intent,
              review: answer,
              problem: Option.none(),
            })
          : LinkStep.Refused({
              intent: step.intent,
              confirmed: false,
              outcome: answer,
            }),
      );
    },
    Edited: () =>
      Predicate.isTagged(step, "Reviewed") ||
      Predicate.isTagged(step, "Renewing") ||
      Predicate.isTagged(step, "Refused")
        ? to(entering())
        : state,
    CreateStarted: () =>
      Predicate.isTagged(step, "Reviewed")
        ? to(LinkStep.Creating({ intent: step.intent, review: step.review }))
        : state,
    CreateAnswered: ({ answer }) =>
      Predicate.isTagged(step, "Creating")
        ? to(afterCreate(step, answer))
        : state,
    ShareStarted: () =>
      Predicate.isTagged(step, "Created")
        ? to(LinkStep.Sharing({ link: step.link, delivery: step.delivery }))
        : state,
    ShareEnded: ({ result, pageHidden }) => {
      if (!Predicate.isTagged(step, "Sharing")) return state;

      const settled = LinkStep.Created({
        link: step.link,
        delivery: nextDelivery(step.delivery, result),
      });

      return to(pageHidden ? withoutCode(settled) : settled);
    },
    Concealed: ({ unloading }) =>
      unloading || !Predicate.isTagged(step, "Sharing")
        ? to(withoutCode(step))
        : state,
    Left: () =>
      Predicate.isTagged(step, "Created") &&
      !delivered(step.delivery) &&
      !step.link.savedOnDevice
        ? to(lost(step.link))
        : state,
    CheckStarted: () =>
      Predicate.isTagged(step, "Refused") || Predicate.isTagged(step, "Checked")
        ? to(LinkStep.Checking())
        : state,
    CheckAnswered: ({ answer }) => {
      if (!Predicate.isTagged(step, "Checking")) return state;

      if (!Predicate.isTagged(answer, "LatestPaymentLink"))
        return to(LinkStep.Checked({ outcome: answer }));

      return to(answer.savedOnDevice ? saved(answer) : lost(answer));
    },
  });
};

export const holdsUnsharedLink = (step: LinkStep) =>
  Match.valueTags(step, {
    Entering: () => false,
    Reviewing: () => false,
    Reviewed: () => false,
    Renewing: () => false,
    Creating: () => true,
    Refused: () => false,
    Created: ({ link, delivery }) =>
      !link.savedOnDevice && !delivered(delivery),
    Sharing: ({ link, delivery }) =>
      !link.savedOnDevice && !delivered(delivery),
    Sent: () => false,
    Saved: () => false,
    Lost: () => false,
    Checking: () => false,
    Checked: () => false,
  });
