import { Link } from "@tanstack/react-router";
import { CheckIcon, FlaskConicalIcon } from "lucide-react";
import type {
  LocalAmount,
  PayoutStep,
  PeruvianMobile,
} from "@workspace/wallet";
import { cn } from "@workspace/ui/lib/utils";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { OrchidBloom } from "@/components/orchid-bloom";
import { Screen, ScreenActions } from "@/components/screen";
import { ResultLink } from "@/links/link-result";
import { m } from "@/paraglide/messages";

import { localAmountLabel, mobileLabel } from "./payout-labels";

export function SimulationNotice() {
  return (
    <aside
      data-testid="payout-simulation"
      className="flex items-start gap-3 rounded-lg bg-secondary px-4 py-3"
    >
      <FlaskConicalIcon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-icon-muted"
      />
      <div className="flex flex-col gap-0.5">
        <p className="text-label">{m.payout_simulation_title()}</p>
        <p className="text-caption text-pretty text-muted-foreground">
          {m.payout_simulation_note()}
        </p>
      </div>
    </aside>
  );
}

type StageState = "done" | "current" | "upcoming";

const stagesFor = (status: Option.Option<PayoutStep>) => {
  const reached = Option.match(status, {
    onNone: () => 1,
    onSome: (found) =>
      Predicate.isTagged(found, "PayoutCompleted")
        ? 3
        : Predicate.isTagged(found, "PayoutProcessing")
          ? 2
          : 1,
  });

  const stateAt = (index: number): StageState =>
    Match.value(index).pipe(
      Match.when(
        (position) => position < reached || reached === 3,
        (): StageState => "done",
      ),
      Match.when(reached, (): StageState => "current"),
      Match.orElse((): StageState => "upcoming"),
    );

  return [
    {
      key: "sending",
      title: m.payout_step_sending(),
      note: m.payout_step_sending_note(),
      state: stateAt(1),
    },
    {
      key: "processing",
      title: m.payout_step_processing(),
      note: m.payout_step_processing_note(),
      state: stateAt(2),
    },
    {
      key: "completed",
      title: m.payout_step_completed(),
      note: m.payout_step_completed_note(),
      state: stateAt(3),
    },
  ];
};

function StageMarker({ state }: { state: StageState }) {
  return (
    <span
      className={cn(
        "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-300",
        state === "done" && "border-primary bg-primary text-primary-foreground",
        state === "current" && "border-primary bg-background",
        state === "upcoming" && "border-border bg-background",
      )}
    >
      {Match.value(state).pipe(
        Match.when("done", () => (
          <CheckIcon aria-hidden="true" className="size-3.5" strokeWidth={3} />
        )),
        Match.when("current", () => (
          <span className="size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
        )),
        Match.orElse(() => null),
      )}
    </span>
  );
}

export function PayoutTracker({
  local,
  mobile,
  status,
}: {
  local: LocalAmount;
  mobile: PeruvianMobile;
  status: Option.Option<PayoutStep>;
}) {
  const completed = Option.exists(status, (found) =>
    Predicate.isTagged(found, "PayoutCompleted"),
  );

  const stages = stagesFor(status);

  return (
    <Screen>
      <main
        data-testid="payout-status"
        data-status={Option.match(status, {
          onNone: () => "PayoutSending",
          onSome: (found) => found._tag,
        })}
        className="flex flex-1 flex-col gap-8 px-5 pt-4"
      >
        <SimulationNotice />
        <header
          role="status"
          className="flex flex-col items-center gap-2 text-center"
        >
          <OrchidBloom
            motion={completed ? "flourish" : "breathe"}
            className="size-24"
          />
          <h1 className="text-body text-muted-foreground">
            {completed ? m.payout_completed_title() : m.payout_status_title()}
          </h1>
          <p className="font-display text-display tabular-nums">
            {localAmountLabel(local)}
          </p>
          <p className="inline-flex items-center gap-2 text-label text-muted-foreground">
            <img
              src="/cash-out/logos/yape.png"
              alt=""
              className="size-5 rounded-sm"
            />
            {m.payout_status_to({ mobile: mobileLabel(mobile) })}
          </p>
        </header>
        <ol className="flex flex-col">
          {stages.map((stage, index) => (
            <li
              key={stage.key}
              data-state={stage.state}
              className="relative flex gap-4 pb-6 last:pb-0"
            >
              {index < stages.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-6 bottom-0 left-2.75 w-0.5 transition-colors duration-300",
                    stage.state === "done" ? "bg-primary" : "bg-border",
                  )}
                />
              ) : null}
              <StageMarker state={stage.state} />
              <div className="flex flex-col gap-0.5">
                <p
                  className={cn(
                    "text-label-lg",
                    stage.state === "upcoming" && "text-muted-foreground",
                  )}
                >
                  {stage.title}
                </p>
                <p className="text-body text-pretty text-muted-foreground">
                  {stage.note}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </main>
      <ScreenActions>
        {completed ? (
          <ResultLink link={<Link to="/" />}>{m.payout_done()}</ResultLink>
        ) : null}
      </ScreenActions>
    </Screen>
  );
}
