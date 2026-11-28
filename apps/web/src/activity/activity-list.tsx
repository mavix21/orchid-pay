import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ActivityEntry,
  type PaidRequest,
  type PaymentRequestPaid,
  Profile,
} from "@workspace/wallet";
import * as Option from "effect/Option";

import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/components/modal";
import {
  ActivityRow,
  EntryAvatar,
  amountTone,
} from "@/components/activity-row";
import { explorerAddressUrl } from "@/components/explorer";

import {
  type Party,
  createdAtLabel,
  entryKey,
  paidRequestOf,
  partyName,
  shownEntry,
} from "./entry";

import { m } from "@/paraglide/messages";

export function ActivityList({
  entries,
  paidRequests,
}: {
  entries: ReadonlyArray<ActivityEntry>;
  paidRequests: ReadonlyArray<PaidRequest>;
}) {
  const [opened, setOpened] = useState<Option.Option<ActivityEntry>>(
    Option.none(),
  );

  return (
    <>
      <div role="list" className="-mx-2 flex flex-col gap-1">
        {entries.map((entry) => (
          <ActivityRow
            key={entryKey(entry)}
            entry={entry}
            paidRequest={paidRequestOf(paidRequests, entry)}
            onOpen={() => setOpened(Option.some(entry))}
          />
        ))}
      </div>
      <Modal
        open={Option.isSome(opened)}
        onOpenChange={(open) => {
          if (!open) setOpened(Option.none());
        }}
      >
        <ModalContent testId="activity-detail">
          {Option.match(opened, {
            onNone: () => null,
            onSome: (entry) => (
              <EntryDetail
                entry={entry}
                paidRequest={paidRequestOf(paidRequests, entry)}
                onClose={() => setOpened(Option.none())}
              />
            ),
          })}
        </ModalContent>
      </Modal>
    </>
  );
}

function EntryDetail({
  entry,
  paidRequest,
  onClose,
}: {
  entry: ActivityEntry;
  paidRequest: Option.Option<PaymentRequestPaid>;
  onClose: () => void;
}) {
  const shown = shownEntry(entry, paidRequest);

  return (
    <>
      <ModalHeader>
        {shown.media !== "link" && "linkClaimer" in shown.media ? (
          <div className="mx-auto w-fit">
            <EntryAvatar media={shown.media} />
          </div>
        ) : null}
        <ModalTitle>{shown.title}</ModalTitle>
        <p
          className={cn(
            "py-2 font-display text-h1 tabular-nums",
            amountTone(shown.direction),
          )}
        >
          {shown.amount}
        </p>
        <ModalDescription>{shown.detail}</ModalDescription>
      </ModalHeader>
      <dl className="flex flex-col gap-4 p-4 pt-6">
        {Option.match(shown.counterparty, {
          onNone: () => null,
          onSome: ({ label, party }) => (
            <DetailField label={label}>
              <PartyValue party={party} />
            </DetailField>
          ),
        })}
        <DetailField label={m.activity_date()}>
          {createdAtLabel(shown.createdAt)}
        </DetailField>
        {Option.match(shown.memo, {
          onNone: () => null,
          onSome: (memo) => (
            <DetailField label={m.common_memo()}>
              <span className="break-all">{memo}</span>
            </DetailField>
          ),
        })}
      </dl>
      <ModalFooter>
        {shown.openLink ? (
          <Button
            className="w-full"
            nativeButton={false}
            render={<Link to="/links" />}
          >
            {m.activity_view_links()}
          </Button>
        ) : null}
        <Button
          className="w-full"
          variant={shown.openLink ? "ghost" : "secondary"}
          onClick={onClose}
        >
          {m.common_close()}
        </Button>
      </ModalFooter>
    </>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-body">{children}</dd>
    </div>
  );
}

function PartyValue({ party }: { party: Party }) {
  const [copied, setCopied] = useState(false);

  if (party instanceof Profile) return partyName(party);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(party.address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <span className="flex items-start gap-2">
      <span className="flex-1 font-mono text-caption break-all">
        {party.address}
      </span>
      <Button
        variant="secondary"
        size="icon"
        aria-label={
          copied ? m.activity_address_copied() : m.activity_copy_address()
        }
        onClick={() => void copy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <Button
        variant="secondary"
        size="icon"
        aria-label={m.explorer_view()}
        nativeButton={false}
        render={
          <a
            href={explorerAddressUrl(party.address)}
            target="_blank"
            rel="noreferrer"
          />
        }
      >
        <ExternalLinkIcon />
      </Button>
    </span>
  );
}
