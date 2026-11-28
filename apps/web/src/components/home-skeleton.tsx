import { Skeleton } from "@workspace/ui/components/skeleton";

import { Screen } from "@/components/screen";
import { m } from "@/paraglide/messages";

const actionTiles = ["send", "request", "receive"];
const activityRows = ["first", "second", "third"];

export function HomeSkeleton() {
  return (
    <Screen>
      <main
        aria-busy="true"
        aria-label={m.home_loading()}
        className="flex flex-1 flex-col gap-10 px-5 pt-2 pb-30 md:pb-16"
      >
        <section className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            <Skeleton variant="avatar" className="size-10" />
            <Skeleton className="h-5 w-32" />
          </div>
          <div className="flex flex-col gap-1">
            <Skeleton className="h-14 w-44" />
          </div>
          <div className="flex gap-2">
            {actionTiles.map((tile) => (
              <div
                key={tile}
                className="flex flex-1 flex-col items-center gap-2"
              >
                <Skeleton variant="tile" className="h-14 w-full" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-label-lg">{m.nav_activity()}</h2>
          <div className="flex flex-col gap-1">
            {activityRows.map((row) => (
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
        </section>
      </main>
    </Screen>
  );
}
