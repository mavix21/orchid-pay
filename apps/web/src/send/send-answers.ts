import type {
  Asset,
  ConfirmOutcome,
  PaymentReview,
  ResumeOutcome,
  ReviewOutcome,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { FieldProblem } from "./intent";
import { SendScreen, deviceFailure, sendResult } from "./outcomes";
import { type Answer, DeviceFailure } from "./use-wallet-task";

import { m } from "@/paraglide/messages";

export type Answered = Data.TaggedEnum<{
  Shown: { readonly review: PaymentReview };
  Refused: { readonly problem: string };
  Corrected: { readonly outcome: string; readonly problem: FieldProblem };
  Concluded: { readonly outcome: string; readonly screen: SendScreen };
  Offered: { readonly problem: FieldProblem };
}>;

export const Answered = Data.taggedEnum<Answered>();

export type ReviewAnswer = Exclude<
  Answered,
  Data.TaggedEnum.Value<Answered, "Refused">
>;

export type OutcomeAnswer = Exclude<
  ReviewAnswer,
  | Data.TaggedEnum.Value<ReviewAnswer, "Shown">
  | Data.TaggedEnum.Value<ReviewAnswer, "Offered">
>;

export const readOutcome = (
  answer: Answer<ResumeOutcome>,
  asset: Asset,
): OutcomeAnswer => {
  if (answer instanceof DeviceFailure)
    return Answered.Concluded({
      outcome: answer._tag,
      screen: deviceFailure(),
    });

  const result = sendResult(answer, asset);

  return result instanceof FieldProblem
    ? Answered.Corrected({ outcome: answer._tag, problem: result })
    : Answered.Concluded({ outcome: answer._tag, screen: result });
};

const readOffer = (
  answer: Answer<ReviewOutcome | ConfirmOutcome>,
  asset: Asset,
): Option.Option<Data.TaggedEnum.Value<Answered, "Offered">> => {
  if (!Predicate.isTagged(answer, "RecipientCannotReceive") || !answer.linkable)
    return Option.none();

  const result = sendResult(answer, asset);

  return result instanceof FieldProblem
    ? Option.some(Answered.Offered({ problem: result }))
    : Option.none();
};

export const readReview = (
  answer: Answer<ReviewOutcome>,
  asset: Asset,
): ReviewAnswer => {
  if (Predicate.isTagged(answer, "PaymentReview"))
    return Answered.Shown({ review: answer });

  return Option.getOrElse(readOffer(answer, asset), () =>
    readOutcome(answer, asset),
  );
};

export const unreleased = new Set([
  "PaymentReview",
  "PasskeyCancelled",
  "PasskeyFailed",
  "WrongCredential",
  "AssertionRejected",
  "PrfOutputMissing",
  "CorruptDeviceWallet",
]);

export const readConfirm = (
  answer: Answer<ConfirmOutcome>,
  asset: Asset,
): Answered =>
  answer instanceof DeviceFailure
    ? readOutcome(answer, asset)
    : Match.value(answer).pipe(
        Match.tag("RecipientCannotReceive", (refused) =>
          Option.getOrElse(readOffer(refused, asset), () =>
            readOutcome(refused, asset),
          ),
        ),
        Match.tag("PaymentReview", (review) => Answered.Shown({ review })),
        Match.tag("PasskeyCancelled", () =>
          Answered.Refused({ problem: m.send_passkey_cancelled() }),
        ),
        Match.tag("PasskeyFailed", () =>
          Answered.Refused({ problem: m.send_passkey_failed() }),
        ),
        Match.tag("WrongCredential", () =>
          Answered.Refused({ problem: m.send_wrong_credential() }),
        ),
        Match.tag("AssertionRejected", () =>
          Answered.Refused({ problem: m.send_assertion_rejected() }),
        ),
        Match.tag("PrfOutputMissing", (missing) =>
          Answered.Concluded({
            outcome: missing._tag,
            screen: new SendScreen(
              m.opening_prf_missing_title(),
              `${m.send_passkey_unopened()} ${m.send_untouched()}`,
              "home",
            ),
          }),
        ),
        Match.tag("CorruptDeviceWallet", (damaged) =>
          Answered.Concluded({
            outcome: damaged._tag,
            screen: new SendScreen(
              m.opening_corrupt_title(),
              `${m.corrupt_device_wallet()} ${m.send_untouched()}`,
              "home",
            ),
          }),
        ),
        Match.orElse((outcome) => readOutcome(outcome, asset)),
      );
