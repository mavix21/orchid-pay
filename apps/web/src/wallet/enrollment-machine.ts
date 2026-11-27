import type {
  EnrollWalletOutcome,
  EnrollmentPending,
  LinkReceiveReview,
  ReadLinkCode,
} from "@workspace/wallet";
import { usernameMaxLength, usernameMinLength } from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { retryable, unavailableMessage } from "@/wallet/unavailable";
import { m } from "@/paraglide/messages";

export type Refusal = Exclude<
  EnrollWalletOutcome,
  {
    _tag:
      | "EnrollmentPending"
      | "WalletEnrolled"
      | "OpeningPending"
      | "WalletOnDevice";
  }
>;

export type Moment = "start" | "activation" | "release";

export class Problem extends Data.Class<{
  readonly message: string;
  readonly prfUnsupported: boolean;
  readonly stopped: boolean;
  readonly takenName: boolean;
}> {}

export const notice = (message: string) =>
  new Problem({
    message,
    prfUnsupported: false,
    stopped: false,
    takenName: false,
  });

export const stoppedBy = (message: string) =>
  new Problem({
    message,
    prfUnsupported: false,
    stopped: true,
    takenName: false,
  });

export const resignedProblem = () => notice(m.enrollment_resigned());

export const unsupportedDeviceProblem = () =>
  stoppedBy(m.device_cannot_store_key());

export type EnrollmentStep = Data.TaggedEnum<{
  Checking: {};
  Choosing: {
    readonly problem: Option.Option<Problem>;
    readonly busy: boolean;
  };
  Activating: {
    readonly pending: EnrollmentPending;
    readonly problem: Option.Option<Problem>;
    readonly receiveBlocked: boolean;
    readonly refreshing: boolean;
  };
  Confirming: {
    readonly pending: EnrollmentPending;
    readonly committing: boolean;
  };
  Finishing: { readonly username: string };
}>;

export const EnrollmentStep = Data.taggedEnum<EnrollmentStep>();

export type Activating = Extract<
  EnrollmentStep,
  { readonly _tag: "Activating" }
>;

export type EnrollmentEvent = Data.TaggedEnum<{
  Checked: {
    readonly pending: Option.Option<EnrollmentPending>;
    readonly saved: Option.Option<string>;
    readonly problem: Option.Option<Problem>;
  };
  Edited: {};
  Submitted: {};
  Confirmed: {};
  Committing: {};
  Pending: {
    readonly pending: EnrollmentPending;
    readonly problem: Option.Option<Problem>;
  };
  Refused: {
    readonly refusal: Refusal;
    readonly moment: Moment;
    readonly pending: Option.Option<EnrollmentPending>;
  };
  Noted: { readonly problem: Problem };
  ReceiveBlocked: { readonly problem: Problem };
  ReceiveRetried: {};
  Refreshing: {};
  Refreshed: { readonly pending: EnrollmentPending };
  Lapsed: {};
  Finished: { readonly username: string };
  Discarded: {};
}>;

export const EnrollmentEvent = Data.taggedEnum<EnrollmentEvent>();

const refusalMessage = (refusal: Refusal, moment: Moment) =>
  Match.valueTags(refusal, {
    InvalidUsername: () =>
      m.username_rule({ min: usernameMinLength, max: usernameMaxLength }),
    UsernameTaken: ({ username }) =>
      moment === "start"
        ? m.enrollment_username_taken({ username })
        : m.enrollment_username_taken_meanwhile({ username }),
    HumanCheckRefused: () => m.human_check_refused(),
    DraftRejected: () => m.enrollment_resigned(),
    NoWallet: () => m.enrollment_interrupted(),
    BackupUnsupported: () => m.enrollment_prf_unsupported(),
    PasskeyCancelled: () =>
      moment === "start"
        ? m.enrollment_passkey_cancelled_start()
        : m.enrollment_passkey_cancelled_confirm(),
    PasskeyFailed: () => m.passkey_failed(),
    WrongCredential: () => m.enrollment_wrong_credential(),
    AssertionRejected: () => m.enrollment_assertion_rejected(),
    CorruptEnvelope: () => m.enrollment_corrupt_envelope(),
    CorruptDeviceWallet: () => m.corrupt_device_wallet(),
    ChallengeRefused: () => m.enrollment_lapsed(),
    RegistrationRefused: () => m.enrollment_registration_refused(),
    UnsupportedDevice: () => m.device_cannot_store_key(),
    LinkCodeMismatch: () => m.enrollment_link_mismatch(),
    Offline: unavailableMessage,
    ServerUnreachable: unavailableMessage,
    LedgerUnreachable: unavailableMessage,
    ServiceFailed: unavailableMessage,
    SessionRequired: unavailableMessage,
    RateLimited: unavailableMessage,
    InvalidResponse: unavailableMessage,
  });

const problemOf = (refusal: Refusal, moment: Moment) =>
  new Problem({
    message: refusalMessage(refusal, moment),
    prfUnsupported: Predicate.isTagged(refusal, "BackupUnsupported"),
    stopped:
      !retryable(refusal) ||
      Predicate.isTagged(refusal, "UnsupportedDevice") ||
      Predicate.isTagged(refusal, "CorruptDeviceWallet"),
    takenName:
      Predicate.isTagged(refusal, "UsernameTaken") && moment === "start",
  });

const activating = (
  pending: EnrollmentPending,
  problem: Option.Option<Problem>,
) =>
  EnrollmentStep.Activating({
    pending,
    problem,
    receiveBlocked: false,
    refreshing: false,
  });

const choosing = (problem: Option.Option<Problem>) =>
  EnrollmentStep.Choosing({ problem, busy: false });

const whenActivating = (
  stage: EnrollmentStep,
  next: (current: Activating) => EnrollmentStep,
) => (EnrollmentStep.$is("Activating")(stage) ? next(stage) : stage);

export const advanceEnrollment = (
  stage: EnrollmentStep,
  event: EnrollmentEvent,
): EnrollmentStep =>
  Match.valueTags(event, {
    Checked: ({ pending, saved, problem }) =>
      Option.match(saved, {
        onSome: (username) => EnrollmentStep.Finishing({ username }),
        onNone: () =>
          Option.match(pending, {
            onSome: (current) => activating(current, problem),
            onNone: () => choosing(problem),
          }),
      }),
    Edited: () =>
      EnrollmentStep.$is("Choosing")(stage) &&
      Option.exists(stage.problem, (shown) => !shown.stopped)
        ? choosing(Option.none())
        : stage,
    Submitted: () =>
      EnrollmentStep.Choosing({ problem: Option.none(), busy: true }),
    Confirmed: () =>
      whenActivating(stage, ({ pending }) =>
        EnrollmentStep.Confirming({ pending, committing: false }),
      ),
    Committing: () =>
      EnrollmentStep.$is("Confirming")(stage)
        ? EnrollmentStep.Confirming({
            pending: stage.pending,
            committing: true,
          })
        : stage,
    Pending: ({ pending, problem }) => activating(pending, problem),
    Refused: ({ refusal, moment, pending }) => {
      const problem = Option.some(problemOf(refusal, moment));

      return Option.match(pending, {
        onSome: (current) => activating(current, problem),
        onNone: () => choosing(problem),
      });
    },
    Noted: ({ problem }) => choosing(Option.some(problem)),
    ReceiveBlocked: ({ problem }) =>
      whenActivating(stage, (current) =>
        EnrollmentStep.Activating({
          ...current,
          problem: Option.some(problem),
          receiveBlocked: true,
        }),
      ),
    ReceiveRetried: () =>
      whenActivating(stage, (current) =>
        EnrollmentStep.Activating({
          ...current,
          problem: Option.none(),
          receiveBlocked: false,
        }),
      ),
    Refreshing: () =>
      whenActivating(stage, (current) =>
        EnrollmentStep.Activating({ ...current, refreshing: true }),
      ),
    Refreshed: ({ pending }) =>
      whenActivating(stage, () => activating(pending, Option.none())),
    Lapsed: () =>
      whenActivating(stage, () =>
        choosing(Option.some(notice(m.enrollment_lapsed()))),
      ),
    Finished: ({ username }) => EnrollmentStep.Finishing({ username }),
    Discarded: () => choosing(Option.none()),
  });

export const receiveFor = (
  current: EnrollmentPending,
  receive: ReadLinkCode | undefined,
): Option.Option<LinkReceiveReview> =>
  Option.filter(
    Option.fromNullishOr(current.receive),
    (shown) => receive !== undefined && shown.link === receive.link,
  );
