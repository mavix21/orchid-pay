import { Link } from "@tanstack/react-router";
import { ChevronLeftIcon, Flower2Icon } from "lucide-react";
import { useEffect, useReducer, useRef, useState } from "react";
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import {
  currentUntil,
  type EnrollWalletOutcome,
  type EnrollmentPending,
  type ReadLinkCode,
  receiveCurrentUntil,
  type ReviewEnrollmentReceiveOutcome,
  type UsernameIssue,
  usernameIssue,
  usernameMaxLength,
  usernameMinLength,
  type WalletClient,
  type WalletEnrolled,
} from "@workspace/wallet";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { OrchidPending } from "@/components/orchid-pending";
import { Screen, ScreenActions } from "@/components/screen";
import { TopNav, type TopNavAction } from "@/components/top-nav";
import { FlowerAvatar } from "@/components/flower-avatar";
import { receiveRefusal } from "@/links/receive-outcomes";
import { sessionLapse } from "@/wallet/session-lapse";
import { enrollmentClient } from "@/wallet/enrollment";
import {
  EnrollmentEvent,
  EnrollmentStep,
  type Moment,
  advanceEnrollment,
  notice,
  receiveFor,
  resignedProblem,
  stoppedBy,
  unsupportedDeviceProblem,
} from "@/wallet/enrollment-machine";
import { PendingStep, StepLabel } from "@/wallet/enrollment-pending-step";
import {
  HumanCheckWidget,
  useHumanCheckStatus,
} from "@/wallet/human-check-widget";
import { OpeningFlow } from "@/wallet/opening-flow";
import { m } from "@/paraglide/messages";

const issueMessage = (issue: UsernameIssue) =>
  Match.valueTags(issue, {
    ForbiddenCharacter: ({ character }) =>
      /\s/u.test(character)
        ? m.username_has_spaces()
        : /\p{L}/u.test(character)
          ? m.username_accented()
          : m.username_allowed(),
    UsernameTooLong: () => m.username_too_long({ max: usernameMaxLength }),
    UsernameTooShort: () => m.username_too_short({ min: usernameMinLength }),
  });

interface EnrollmentFlowProps {
  title: string;
  incoming?: string;
  back: (disabled: boolean) => TopNavAction;
  walletClient: WalletClient;
  receive?: ReadLinkCode;
  onEnrolled: (enrolled: WalletEnrolled) => void;
  onOpened: () => void;
  onRestore?: () => void;
}

export function EnrollmentFlow({
  title,
  incoming,
  back,
  walletClient,
  receive,
  onEnrolled,
  onOpened,
  onRestore,
}: EnrollmentFlowProps) {
  const [stage, dispatch] = useReducer(
    advanceEnrollment,
    EnrollmentStep.Checking(),
  );

  const [username, setUsername] = useState("");
  const [touched, setTouched] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const send = (event: EnrollmentEvent) => {
    if (mounted.current) dispatch(event);
  };

  const humanCheck = useHumanCheckStatus();

  useEffect(() => {
    let current = true;

    void Promise.all([walletClient.saved(), enrollmentClient.pending()]).then(
      ([saved, pending]) => {
        if (!current) return;

        const savedName = Predicate.isTagged(saved, "SavedWallet")
          ? Option.some(saved.username)
          : Option.none<string>();

        setUsername(
          Option.match(pending, {
            onSome: (found) => found.username,
            onNone: () => Option.getOrElse(savedName, () => ""),
          }),
        );

        send(
          EnrollmentEvent.Checked({
            pending,
            saved: Option.isNone(pending) ? savedName : Option.none(),
            problem: Predicate.isTagged(saved, "UnsupportedDevice")
              ? Option.some(unsupportedDeviceProblem())
              : Option.none(),
          }),
        );
      },
    );

    return () => {
      current = false;
    };
  }, [walletClient]);

  const readReceive = (answer: ReviewEnrollmentReceiveOutcome) => {
    if (Predicate.isTagged(answer, "EnrollmentPending")) {
      send(EnrollmentEvent.Refreshed({ pending: answer }));

      return;
    }

    if (Predicate.isTagged(answer, "UsernameTaken")) {
      send(
        EnrollmentEvent.Refused({
          refusal: answer,
          moment: "activation",
          pending: Option.none(),
        }),
      );

      return;
    }

    send(
      EnrollmentEvent.ReceiveBlocked({
        problem: notice(receiveRefusal(answer)),
      }),
    );
  };

  const activeRecord = EnrollmentStep.$is("Activating")(stage)
    ? stage.pending
    : undefined;

  const awaitingReceive =
    EnrollmentStep.$is("Activating")(stage) &&
    !stage.receiveBlocked &&
    receive !== undefined &&
    stage.pending.stage === "activate" &&
    Option.isNone(receiveFor(stage.pending, receive));

  useEffect(() => {
    if (!awaitingReceive || receive === undefined) return;

    let current = true;

    void enrollmentClient.reviewReceive(receive.code).then((answer) => {
      if (current) readReceive(answer);
    });

    return () => {
      current = false;
    };
  }, [awaitingReceive, receive]);

  useEffect(() => {
    if (activeRecord === undefined || discarding) return;

    const { stage: step, review } = activeRecord;

    if (step !== "activate" || review === undefined) return;

    const shownReceive = receiveFor(activeRecord, receive);

    const remaining =
      Math.min(
        currentUntil(review),
        Option.match(shownReceive, {
          onNone: () => Number.POSITIVE_INFINITY,
          onSome: receiveCurrentUntil,
        }),
      ) - Date.now();

    if (remaining <= 0) return;

    let current = true;

    const timer = setTimeout(() => {
      send(EnrollmentEvent.Refreshing());
      void enrollmentClient.pending().then(async (next) => {
        if (!current) return;

        if (Option.isNone(next)) {
          send(EnrollmentEvent.Lapsed());

          return;
        }

        const reviewed =
          Option.isSome(shownReceive) && receive !== undefined
            ? Option.some(await enrollmentClient.reviewReceive(receive.code))
            : Option.none<ReviewEnrollmentReceiveOutcome>();

        if (!current) return;

        send(EnrollmentEvent.Refreshed({ pending: next.value }));

        if (Option.isSome(reviewed)) readReceive(reviewed.value);
      });
    }, remaining);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [activeRecord, receive, discarding]);

  const finishOpening = async () => {
    const saved = await walletClient.saved();

    if (Predicate.isTagged(saved, "SavedWallet")) {
      setUsername(saved.username);
      send(EnrollmentEvent.Finished({ username: saved.username }));

      return;
    }

    send(
      EnrollmentEvent.Noted({
        problem: stoppedBy(m.enrollment_account_on_device()),
      }),
    );
  };

  const answer = async (outcome: EnrollWalletOutcome, moment: Moment) => {
    await Match.value(outcome).pipe(
      Match.tag("EnrollmentPending", (next) => {
        setUsername(next.username);
        send(
          EnrollmentEvent.Pending({ pending: next, problem: Option.none() }),
        );
      }),
      Match.tag("WalletEnrolled", (enrolled) => {
        if (mounted.current) onEnrolled(enrolled);
      }),
      Match.tag("OpeningPending", finishOpening),
      Match.tag("WalletOnDevice", finishOpening),
      Match.orElse(async (refusal) => {
        send(
          EnrollmentEvent.Refused({
            refusal,
            moment,
            pending: await enrollmentClient.pending(),
          }),
        );
      }),
    );
  };

  const typedIssue = usernameIssue(username);

  const blockingIssue = typedIssue.pipe(
    Option.filter((found) => !Predicate.isTagged(found, "UsernameTooShort")),
  );

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);

    if (Option.isSome(typedIssue)) return;

    send(EnrollmentEvent.Submitted());
    void enrollmentClient
      .start(username)
      .then((outcome) => answer(outcome, "start"));
  };

  const confirm = (current: EnrollmentPending) => {
    const moment: Moment =
      current.stage === "activate" ? "activation" : "release";

    const shownReceive = Option.getOrUndefined(receiveFor(current, receive));

    send(EnrollmentEvent.Confirmed());
    void enrollmentClient
      .advance(
        current.review,
        receive !== undefined && shownReceive !== undefined
          ? { review: shownReceive, code: receive.code }
          : undefined,
        () => send(EnrollmentEvent.Committing()),
      )
      .then(async (outcome) => {
        if (
          moment === "activation" &&
          (Predicate.isTagged(outcome, "WalletEnrolled") ||
            Predicate.isTagged(outcome, "OpeningPending"))
        )
          sessionLapse.clear();

        if (
          current.review !== undefined &&
          Predicate.isTagged(outcome, "EnrollmentPending") &&
          outcome.stage === "activate"
        ) {
          send(
            EnrollmentEvent.Pending({
              pending: outcome,
              problem: Option.some(resignedProblem()),
            }),
          );

          return;
        }

        await answer(outcome, moment);
      });
  };

  const chooseAnother = () => {
    if (discarding) return;

    setDiscarding(true);
    void enrollmentClient.discard().then(async (discarded) => {
      const next = discarded
        ? Option.none<EnrollmentPending>()
        : await enrollmentClient.pending();

      if (!mounted.current) return;

      setDiscarding(false);
      send(
        Option.match(next, {
          onNone: () => EnrollmentEvent.Discarded(),
          onSome: (current) =>
            EnrollmentEvent.Pending({
              pending: current,
              problem: Option.none(),
            }),
        }),
      );
    });
  };

  const busy =
    EnrollmentStep.$is("Confirming")(stage) ||
    (EnrollmentStep.$is("Choosing")(stage) && stage.busy);

  return (
    <Screen>
      <TopNav
        title={title}
        label={m.common_back()}
        icon={<ChevronLeftIcon />}
        disabled={busy}
        {...back(busy)}
      />
      {incoming === undefined ? null : (
        <p
          data-testid="incoming-amount"
          className="mx-auto mt-1 rounded-full bg-secondary px-4 py-1.5 text-center text-label text-balance"
        >
          {incoming}
        </p>
      )}
      {EnrollmentStep.$match(stage, {
        Checking: () => <OrchidPending title={m.account_preparing()} />,
        Finishing: ({ username: name }) => (
          <>
            <div className="flex flex-1 flex-col">
              <OpeningFlow username={name} onOpened={onOpened} />
            </div>
            <HumanCheckWidget quiet />
          </>
        ),
        Confirming: ({ pending, committing }) => {
          const opening = committing || pending.stage === "release";

          return (
            <OrchidPending
              title={
                opening
                  ? Option.isSome(receiveFor(pending, receive))
                    ? m.enrollment_opening_receiving()
                    : m.enrollment_creating()
                  : m.passkey_confirm_title()
              }
              note={
                opening
                  ? m.account_takes_seconds()
                  : m.enrollment_device_will_ask()
              }
            />
          );
        },
        Activating: (current) => (
          <PendingStep
            current={current}
            receive={receive}
            onConfirm={() => confirm(current.pending)}
            onChooseAnother={chooseAnother}
            discarding={discarding}
            onRecheckReceive={() => send(EnrollmentEvent.ReceiveRetried())}
          />
        ),
        Choosing: ({ problem: found, busy: starting }) => {
          const fieldMessage = Option.match(
            touched ? typedIssue : blockingIssue,
            {
              onNone: () => Option.getOrUndefined(found)?.message,
              onSome: issueMessage,
            },
          );

          const length = Array.from(username).length;

          return (
            <>
              <form
                id="choose-username"
                className="flex flex-1 flex-col"
                noValidate
                onSubmit={submit}
              >
                <main className="flex flex-1 flex-col justify-center gap-6 px-5 py-8">
                  <div className="flex flex-col gap-2">
                    <StepLabel>{m.enrollment_step_one()}</StepLabel>
                    <h1 className="font-display text-h1">
                      {m.enrollment_choose_title()}
                    </h1>
                    <p className="text-body text-muted-foreground">
                      {m.enrollment_choose_explanation()}
                    </p>
                  </div>
                  <div className="flex justify-center">
                    {Option.isNone(typedIssue) ? (
                      <FlowerAvatar username={username} size="xl" />
                    ) : (
                      <Avatar size="xl">
                        <AvatarFallback>
                          <Flower2Icon className="size-8 text-icon-muted" />
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                  <Field>
                    <FieldLabel htmlFor="username">
                      {m.enrollment_username_label()}
                    </FieldLabel>
                    <InputGroup>
                      <InputGroupAddon>@</InputGroupAddon>
                      <InputGroupInput
                        id="username"
                        name="username"
                        value={username}
                        onChange={(event) => {
                          setUsername(event.target.value.toLowerCase());
                          send(EnrollmentEvent.Edited());
                        }}
                        onBlur={() => setTouched(username.length > 0)}
                        disabled={
                          starting ||
                          Option.exists(found, (shown) => shown.stopped)
                        }
                        aria-invalid={fieldMessage ? true : undefined}
                        aria-describedby={
                          fieldMessage ? "username-error" : undefined
                        }
                        autoComplete="username"
                        autoCapitalize="none"
                        spellCheck={false}
                        autoFocus
                      />
                      <InputGroupAddon align="inline-end">
                        <span
                          data-exceeded={length > usernameMaxLength}
                          className="text-label tabular-nums data-[exceeded=true]:text-destructive"
                        >
                          {length}/{usernameMaxLength}
                        </span>
                      </InputGroupAddon>
                    </InputGroup>
                    {fieldMessage ? (
                      <FieldError
                        id="username-error"
                        data-testid={
                          Option.exists(found, (shown) => shown.prfUnsupported)
                            ? "prf-unsupported"
                            : undefined
                        }
                      >
                        {fieldMessage}
                      </FieldError>
                    ) : null}
                    {Option.exists(found, (shown) => shown.takenName) ? (
                      onRestore === undefined ? (
                        <Link
                          to="/restore"
                          className="text-label text-primary underline-offset-4 hover:underline"
                        >
                          {m.enrollment_is_it_yours()}
                        </Link>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={onRestore}
                        >
                          {m.enrollment_is_it_yours()}
                        </Button>
                      )
                    ) : null}
                  </Field>
                </main>
              </form>
              <ScreenActions>
                <HumanCheckWidget />
                <Button
                  className="w-full"
                  type="submit"
                  form="choose-username"
                  data-testid="create-submit"
                  disabled={
                    starting ||
                    humanCheck !== "ready" ||
                    Option.exists(found, (shown) => shown.stopped) ||
                    username.length === 0 ||
                    Option.isSome(blockingIssue)
                  }
                >
                  {starting
                    ? m.enrollment_creating_passkey()
                    : m.enrollment_create_passkey()}
                </Button>
              </ScreenActions>
            </>
          );
        },
      })}
    </Screen>
  );
}
