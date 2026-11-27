import {
  ArrowLeftRightIcon,
  ClockIcon,
  HouseIcon,
  SettingsIcon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

import { m } from "@/paraglide/messages";

const itemClass =
  "flex h-12 w-16 items-center justify-center rounded-full text-icon-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:text-icon-accent [&_svg]:size-6";

export function TabBar() {
  return (
    <nav
      aria-label={m.nav_main()}
      className="fixed bottom-safe left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border bg-card p-1 md:hidden"
    >
      <Link to="/home" aria-label={m.nav_home()} className={itemClass}>
        <HouseIcon />
      </Link>
      <button type="button" aria-label={m.nav_swap()} className={itemClass}>
        <ArrowLeftRightIcon />
      </button>
      <Link to="/activity" aria-label={m.nav_activity()} className={itemClass}>
        <ClockIcon />
      </Link>
      <Link
        to="/settings"
        aria-label={m.settings_title()}
        className={itemClass}
      >
        <SettingsIcon />
      </Link>
    </nav>
  );
}
