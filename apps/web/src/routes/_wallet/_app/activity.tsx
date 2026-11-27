import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Skeleton } from "@workspace/ui/components/skeleton";
import type {
  ActivityCursor,
  ActivityEntry,
  ActivityOutcome,
  PaidRequest,
  RequestActivityPage,
} from "@workspace/wallet";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { ActivityList } from "@/activity/activity-list";
import { NoEntries } from "@/activity/recent-activity";
import { Screen, ScreenNote, ScreenStatus } from "@/components/screen";
import { useWalletTask } from "@/send/use-wallet-task";
import { paymentRequestEffects } from "@/wallet/payment-requests";
import { unavailableMessage } from "@/wallet/unavailable";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_wallet/_app/activity")({
  ssr: false,
  pendingMs: 0,
  pendingComponent: ActivitySkeleton,
  loader: async () => {
    return {
      activity: await Effect.runPromise(paymentRequestEffects.activity()),
    };
  },
  component: AllActivity,
});

const skeletonRows = ["first", "second", "third", "fourth"];

function ActivityFrame({ children }: { children: React.ReactNode }) {
  return (
    <Screen>
      <main className="flex flex-1 flex-col gap-4 px-5 pt-6 pb-30 md:pt-2 md:pb-16">
        <h1 className="font-display text-h1">{m.nav_activity()}</h1>
        {children}
      </main>
    </Screen>
  );
}

function ActivitySkeleton() {
  return (
    <ActivityFrame>
      <div
        aria-busy="true"
        aria-label={m.activity_loading()}
        className="flex flex-col gap-1"
      >
        {skeletonRows.map((row) => (
          <div key={row} className="flex items-center gap-3 px-1 py-3">
            <Skeleton variant="avatar" className="size-10" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-4 w-14" />
          </div>
        ))}
      </div>
    </ActivityFrame>
  );
}

const activityProblem = (
  activity: Exclude<ActivityOutcome, { _tag: "RequestActivityPage" }>,
) =>
  Match.valueTags(activity, {
    NotOpened: () => m.common_account_activating(),
    InvalidAddress: () => m.common_stored_key_invalid(),
    NoWallet: () => m.session_no_wallet(),
    UnsupportedDevice: () => m.device_cannot_read_key(),
    Offline: unavailableMessage,
    ServerUnreachable: unavailableMessage,
    LedgerUnreachable: unavailableMessage,
    ServiceFailed: unavailableMessage,
    SessionRequired: unavailableMessage,
    RateLimited: unavailableMessage,
    InvalidResponse: unavailableMessage,
  });

function AllActivity() {
  const { activity } = Route.useLoaderData();
  const loadedAt = Route.useMatch({ select: (match) => match.updatedAt });

  if (!Predicate.isTagged(activity, "RequestActivityPage"))
    return <ActivityProblem message={activityProblem(activity)} />;

  return (
    <ActivityFrame>
      {activity.page.entries.length === 0 ? (
        <NoEntries />
      ) : (
        <ActivityPages key={loadedAt} first={activity} />
      )}
    </ActivityFrame>
  );
}

type Loaded = {
  readonly entries: ReadonlyArray<ActivityEntry>;
  readonly paidRequests: ReadonlyArray<PaidRequest>;
  readonly next: Option.Option<ActivityCursor>;
};

function ActivityPages({ first }: { first: RequestActivityPage }) {
  const task = useWalletTask();

  const [loaded, setLoaded] = useState<Loaded>({
    entries: first.page.entries,
    paidRequests: first.paidRequests,
    next: Option.fromUndefinedOr(first.page.next),
  });

  const [paging, setPaging] = useState<"idle" | "loading" | "failed">("idle");

  const loadMore = (cursor: ActivityCursor) => {
    setPaging("loading");
    task.run(paymentRequestEffects.activity(cursor), (answer) => {
      if (!Predicate.isTagged(answer, "RequestActivityPage")) {
        setPaging("failed");

        return;
      }

      setPaging("idle");

      setLoaded((current) => ({
        entries: [...current.entries, ...answer.page.entries],
        paidRequests: [...current.paidRequests, ...answer.paidRequests],
        next: Option.fromUndefinedOr(answer.page.next),
      }));
    });
  };

  return (
    <>
      <ActivityList
        entries={loaded.entries}
        paidRequests={loaded.paidRequests}
      />
      {Option.match(loaded.next, {
        onNone: () => null,
        onSome: (cursor) => (
          <div className="flex flex-col gap-2">
            {paging === "failed" ? (
              <p role="alert" className="text-body text-muted-foreground">
                {m.activity_load_failed()}
              </p>
            ) : null}
            <Button
              variant="secondary"
              className="w-full"
              disabled={paging === "loading"}
              onClick={() => loadMore(cursor)}
              data-testid="more-activity"
            >
              {Match.value(paging).pipe(
                Match.when("idle", () => m.activity_load_more()),
                Match.when("loading", () => m.activity_loading_more()),
                Match.when("failed", () => m.common_retry()),
                Match.exhaustive,
              )}
            </Button>
          </div>
        ),
      })}
    </>
  );
}

function ActivityProblem({ message }: { message: string }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  return (
    <Screen>
      <ScreenStatus title={m.activity_load_failed()}>
        <ScreenNote>{message}</ScreenNote>
        <Button
          className="mt-4 w-full"
          disabled={retrying}
          onClick={() => {
            setRetrying(true);
            void router.invalidate().finally(() => setRetrying(false));
          }}
        >
          {m.common_retry()}
        </Button>
      </ScreenStatus>
    </Screen>
  );
}
