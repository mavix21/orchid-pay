import { LinkIcon, WalletIcon } from "lucide-react";
import { Badge } from "@workspace/ui/components/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ActivityEntry,
  type PaymentRequestPaid,
  Profile,
} from "@workspace/wallet";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { FlowerAvatar } from "@/components/flower-avatar";
import { OrchidBloom } from "@/components/orchid-bloom";
import {
  type Direction,
  type EntryMedia,
  type Party,
  createdWhen,
  isLinkClaimerMedia,
  shownEntry,
  walletOpenedBy,
} from "@/activity/entry";

const partyKey = (party: Party) =>
  party instanceof Profile ? party.username : party.address;

export const amountTone = (direction: Direction) =>
  Match.value(direction).pipe(
    Match.when("in", () => "text-positive"),
    Match.when("out", () => "text-foreground"),
    Match.when("unchanged", () => "text-muted-foreground"),
    Match.exhaustive,
  );

export function EntryAvatar({ media }: { media: EntryMedia }) {
  if (media === "link")
    return (
      <ItemMedia variant="icon">
        <LinkIcon absoluteStrokeWidth />
      </ItemMedia>
    );

  const newcomer = walletOpenedBy(media);

  if (Option.isSome(newcomer))
    return (
      <ItemMedia className="relative w-fit">
        <FlowerAvatar username={newcomer.value.username} />
        <span className="absolute inset-1 rounded-full ring-2 ring-background" />
        <span className="absolute inset-0 rounded-full joined-ring" />
        <span className="absolute -right-1 -bottom-1 grid size-5 place-items-center rounded-full bg-background">
          <OrchidBloom motion="rest" className="size-5" />
        </span>
      </ItemMedia>
    );

  if (isLinkClaimerMedia(media))
    return (
      <ItemMedia className="relative">
        <FlowerAvatar username={media.linkClaimer.username} />
        <span
          aria-hidden="true"
          className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-accent text-icon-accent ring-2 ring-background in-data-[slot=dialog-content]:ring-popover in-data-[slot=drawer-content]:ring-popover"
        >
          <LinkIcon absoluteStrokeWidth className="size-3" />
        </span>
      </ItemMedia>
    );

  if (media instanceof Profile)
    return (
      <ItemMedia>
        <FlowerAvatar username={media.username} />
      </ItemMedia>
    );

  return (
    <ItemMedia variant="icon">
      <WalletIcon absoluteStrokeWidth />
    </ItemMedia>
  );
}

export function ActivityRow({
  entry,
  paidRequest,
  onOpen,
}: {
  entry: ActivityEntry;
  paidRequest: Option.Option<PaymentRequestPaid>;
  onOpen: () => void;
}) {
  const shown = shownEntry(entry, paidRequest);

  return (
    <div role="listitem">
      <Item
        size="sm"
        className="text-left"
        render={<button type="button" onClick={onOpen} />}
        data-testid="activity-row"
        data-entry={entry._tag}
        data-paid-request={Option.getOrUndefined(
          Option.map(paidRequest, ({ id }) => id),
        )}
        data-receipt={
          Predicate.isTagged(entry, "SentActivity")
            ? entry.receipt._tag
            : undefined
        }
        data-counterparty={Option.getOrUndefined(
          Option.map(shown.counterparty, ({ party }) => partyKey(party)),
        )}
      >
        <EntryAvatar media={shown.media} />
        <ItemContent>
          <ItemTitle>{shown.title}</ItemTitle>
          <ItemDescription wrap={isLinkClaimerMedia(shown.media)}>
            {Option.isSome(walletOpenedBy(shown.media)) ? (
              <span className="text-accent-foreground">{shown.subtitle}</span>
            ) : (
              shown.subtitle
            )}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <div className="flex flex-col items-end gap-1">
            <span
              className={cn(
                "text-label-lg whitespace-nowrap tabular-nums",
                amountTone(shown.direction),
              )}
            >
              {shown.amount}
            </span>
            {Option.match(shown.badge, {
              onNone: () => (
                <span className="text-caption text-muted-foreground">
                  {createdWhen(shown.createdAt)}
                </span>
              ),
              onSome: (badge) => (
                <Badge variant={badge.variant}>
                  <span className="size-1.5 rounded-full bg-current" />
                  {badge.label}
                </Badge>
              ),
            })}
          </div>
        </ItemActions>
      </Item>
    </div>
  );
}
