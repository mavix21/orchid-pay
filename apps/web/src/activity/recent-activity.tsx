import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import type { ActivityOutcome } from "@workspace/wallet";
import * as Predicate from "effect/Predicate";

import { ActivityList } from "./activity-list";

import { m } from "@/paraglide/messages";

const recentCount = 5;

export function RecentActivity({ activity }: { activity: ActivityOutcome }) {
  return (
    <section
      aria-labelledby="activity-title"
      data-testid="recent-activity"
      className="flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <h2 id="activity-title" className="text-label-lg">
          {m.nav_activity()}
        </h2>
        <Link
          to="/activity"
          className="rounded-xs text-label text-accent-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {m.activity_view_all()}
        </Link>
      </div>
      {Predicate.isTagged(activity, "RequestActivityPage") ? (
        activity.page.entries.length === 0 ? (
          <NoEntries />
        ) : (
          <ActivityList
            entries={activity.page.entries.slice(0, recentCount)}
            paidRequests={activity.paidRequests}
          />
        )
      ) : (
        <ActivityProblem />
      )}
    </section>
  );
}

export function NoEntries() {
  return (
    <p className="py-3 text-body text-muted-foreground">{m.activity_empty()}</p>
  );
}

function ActivityProblem() {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  const retry = () => {
    setRetrying(true);
    void router.invalidate().finally(() => setRetrying(false));
  };

  return (
    <div className="flex flex-col items-start gap-3 py-3">
      <p className="text-body text-muted-foreground">
        {m.activity_load_failed()}
      </p>
      <Button size="sm" variant="secondary" disabled={retrying} onClick={retry}>
        {m.common_retry()}
      </Button>
    </div>
  );
}
