import { Button } from "@workspace/ui/components/button";
import type { ReadLinkCode } from "@workspace/wallet";
import * as Option from "effect/Option";

import { ScreenActions, ScreenNote, ScreenStatus } from "@/components/screen";
import { FlowerAvatar } from "@/components/flower-avatar";
import { amountLabel } from "@/send/money";
import { type Activating, receiveFor } from "@/wallet/enrollment-machine";
import { m } from "@/paraglide/messages";

export function StepLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-label text-primary">{children}</p>;
}

function AccountMedia({
  username,
  step,
}: {
  username: string;
  step: Option.Option<string>;
}) {
  return (
    <div className="flex flex-col items-center gap-5">
      {Option.match(step, {
        onNone: () => null,
        onSome: (label) => <StepLabel>{label}</StepLabel>,
      })}
      <div className="flex flex-col items-center gap-2">
        <FlowerAvatar username={username} size="xl" />
        <p className="text-label-lg">@{username}</p>
      </div>
    </div>
  );
}

export function PendingStep({
  current,
  receive,
  onConfirm,
  onChooseAnother,
  onRecheckReceive,
  discarding,
}: {
  current: Activating;
  receive: ReadLinkCode | undefined;
  onConfirm: () => void;
  onChooseAnother: () => void;
  onRecheckReceive: () => void;
  discarding: boolean;
}) {
  const { pending, problem, receiveBlocked, refreshing } = current;
  const shownReceive = receiveFor(pending, receive);
  const releasing = pending.stage === "release";

  const waitingForReceive =
    receive !== undefined && !releasing && Option.isNone(shownReceive);

  const checkingReceive = waitingForReceive && !receiveBlocked;

  const copy = releasing
    ? {
        title: m.enrollment_finish_title(),
        note: m.enrollment_no_passkey_again(),
        action: m.common_retry(),
      }
    : Option.match(shownReceive, {
        onNone: () => ({
          title: m.enrollment_confirm_passkey(),
          note: m.enrollment_use_new_passkey(),
          action:
            waitingForReceive && receiveBlocked
              ? m.enrollment_create_without_receiving()
              : m.passkey_confirm_action(),
        }),
        onSome: (shown) => ({
          title: m.enrollment_confirm_passkey(),
          note: m.enrollment_use_new_passkey_receive({
            amount: amountLabel(shown.amount, shown.asset),
          }),
          action: m.enrollment_confirm_and_receive(),
        }),
      });

  return (
    <>
      <ScreenStatus
        title={copy.title}
        media={
          <AccountMedia
            username={pending.username}
            step={
              releasing ? Option.none() : Option.some(m.enrollment_step_two())
            }
          />
        }
        data-testid="enrollment-step"
        data-stage={pending.stage}
        data-receive={Option.isSome(shownReceive)}
      >
        <ScreenNote>{copy.note}</ScreenNote>
        {Option.match(problem, {
          onNone: () => null,
          onSome: (shown) => (
            <p
              role="alert"
              className="text-body text-destructive"
              data-testid={shown.prfUnsupported ? "prf-unsupported" : undefined}
            >
              {shown.message}
            </p>
          ),
        })}
      </ScreenStatus>
      <ScreenActions>
        {waitingForReceive && receiveBlocked ? (
          <Button
            className="w-full"
            type="button"
            variant="secondary"
            disabled={refreshing || discarding}
            onClick={onRecheckReceive}
          >
            {m.enrollment_recheck_link()}
          </Button>
        ) : null}
        <Button
          className="w-full"
          type="button"
          data-testid="enrollment-continue"
          disabled={
            refreshing ||
            discarding ||
            checkingReceive ||
            Option.exists(problem, (shown) => shown.stopped)
          }
          onClick={onConfirm}
        >
          {refreshing
            ? m.enrollment_updating()
            : checkingReceive
              ? m.enrollment_checking_link()
              : copy.action}
        </Button>
        {releasing ? null : (
          <Button
            className="w-full"
            type="button"
            variant="ghost"
            disabled={refreshing || discarding}
            onClick={onChooseAnother}
          >
            {m.enrollment_choose_another()}
          </Button>
        )}
      </ScreenActions>
    </>
  );
}
