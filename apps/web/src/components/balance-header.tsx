import { ArrowDownLeftIcon, ArrowUpRightIcon, LinkIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  type Amount,
  baseAsset,
  formatAmount,
  precisionOf,
} from "@workspace/wallet";

import { formattingLocale } from "@/locale/format";
import { ActionTile } from "@/components/action-tile";
import { FlowerAvatar } from "@/components/flower-avatar";
import { m } from "@/paraglide/messages";

const centDigits = 2;

export function BalanceHeader({
  username,
  dollars,
}: {
  username: string;
  dollars: Amount;
}) {
  const [units = "0", fraction = ""] = formatAmount(
    dollars,
    precisionOf(baseAsset),
  ).split(".");

  const whole = BigInt(units).toLocaleString(formattingLocale());
  const cents = fraction.slice(0, centDigits).padEnd(centDigits, "0");

  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <FlowerAvatar username={username} />
        <p
          className="flex-1 truncate text-label-lg"
          data-testid="home-username"
          data-username={username}
        >
          @{username}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <p className="flex items-baseline font-display text-display">
          <span>${whole}</span>
          <span className="text-muted-foreground">.{cents}</span>
        </p>
      </div>
      <div className="flex gap-2">
        <ActionTile
          label={m.common_send()}
          icon={<ArrowUpRightIcon />}
          render={<Link to="/send" data-testid="open-send" />}
        />
        <ActionTile
          label={m.home_action_request()}
          icon={<LinkIcon />}
          render={<Link to="/request" data-testid="open-request" />}
        />
        <ActionTile
          label={m.nav_receive()}
          icon={<ArrowDownLeftIcon />}
          render={<Link to="/receive" data-testid="open-receive" />}
        />
      </div>
    </section>
  );
}
