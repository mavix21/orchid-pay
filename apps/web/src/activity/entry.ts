import {
  type ActivityEntry,
  type Amount,
  type Asset,
  ExternalRecipient,
  LinkRecipient,
  type PaidRequest,
  type PaymentMemo,
  type PaymentRequestPaid,
  Profile,
  type Receipt,
  type ResolvedRecipient,
  type SentActivity,
} from "@workspace/wallet";
import * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { formattingLocale } from "@/locale/format";
import { amountLabel, shortAddress } from "@/send/money";
import { m } from "@/paraglide/messages";

export type Party = Profile | ExternalRecipient;

export type EntryBadge = {
  readonly label: string;
  readonly variant: "warning" | "neutral" | "destructive";
};

export type Direction = "in" | "out" | "unchanged";

export type Counterparty = {
  readonly label: string;
  readonly party: Party;
};

export type EntryMedia = "link" | Party | { readonly linkClaimer: Profile };

export const isLinkClaimerMedia = (media: EntryMedia) =>
  media !== "link" && "linkClaimer" in media;

export type ShownEntry = {
  readonly title: string;
  readonly subtitle: string;
  readonly badge: Option.Option<EntryBadge>;
  readonly direction: Direction;
  readonly amount: string;
  readonly detail: string;
  readonly media: EntryMedia;
  readonly counterparty: Option.Option<Counterparty>;
  readonly memo: Option.Option<string>;
  readonly createdAt: DateTime.Utc;
  readonly openLink: boolean;
};

const sending = (): EntryBadge => ({
  label: m.activity_sending(),
  variant: "warning",
});

const awaitingAcceptance = (): EntryBadge => ({
  label: m.activity_awaiting_acceptance(),
  variant: "warning",
});

const unclaimed = (): EntryBadge => ({
  label: m.activity_unclaimed(),
  variant: "neutral",
});

const notSent = (): EntryBadge => ({
  label: m.activity_not_sent(),
  variant: "destructive",
});

export const partyName = (party: Party) =>
  party instanceof Profile ? `@${party.username}` : shortAddress(party.address);

export const closedOn = (closedAt: DateTime.Utc) => {
  const closed = DateTime.toDate(closedAt);

  return closed.toLocaleDateString(formattingLocale(), {
    day: "numeric",
    month: "long",
    year:
      closed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
};

const signedAmount = (direction: Direction, amount: Amount, asset: Asset) =>
  Match.value(direction).pipe(
    Match.when("in", () => `+${amountLabel(amount, asset)}`),
    Match.when("out", () => `−${amountLabel(amount, asset)}`),
    Match.when("unchanged", () => amountLabel(amount, asset)),
    Match.exhaustive,
  );

const memoText = (memo: PaymentMemo | undefined) =>
  Option.map(Option.fromUndefinedOr(memo), ({ value }) => value);

type Outcome = {
  readonly title: string;
  readonly subtitle: string;
  readonly badge: Option.Option<EntryBadge>;
  readonly direction: Direction;
  readonly detail: string;
  readonly media: EntryMedia;
  readonly counterparty: Option.Option<Counterparty>;
  readonly openLink: boolean;
};

const linkOutcome = (
  outcome: Pick<Outcome, "subtitle" | "badge" | "direction" | "detail"> & {
    readonly claimer?: Party;
    readonly open?: boolean;
  },
): Outcome => ({
  title: m.activity_payment_link(),
  subtitle: outcome.subtitle,
  badge: outcome.badge,
  direction: outcome.direction,
  detail: outcome.detail,
  media:
    outcome.claimer instanceof Profile
      ? { linkClaimer: outcome.claimer }
      : "link",
  counterparty: Option.map(
    Option.fromUndefinedOr(outcome.claimer),
    (party) => ({
      label: m.common_to(),
      party,
    }),
  ),
  openLink: outcome.open ?? false,
});

const claimedLinkOutcome = (
  claimer: Party | undefined,
  closedAt: DateTime.Utc,
  openedWallet: true | undefined,
) =>
  claimer === undefined
    ? linkOutcome({
        subtitle: m.activity_link_claimed_someone(),
        badge: Option.none(),
        direction: "out",
        detail: m.activity_link_claimed_someone_detail({
          date: closedOn(closedAt),
        }),
      })
    : claimer instanceof Profile
      ? linkOutcome({
          subtitle: openedWallet
            ? m.activity_link_joined({ name: partyName(claimer) })
            : m.activity_link_claimed_by({ name: partyName(claimer) }),
          badge: Option.none(),
          direction: "out",
          detail: openedWallet
            ? m.activity_link_joined_detail({
                name: partyName(claimer),
                date: closedOn(closedAt),
              })
            : m.activity_link_claimed_by_detail({
                name: partyName(claimer),
                date: closedOn(closedAt),
              }),
          claimer,
        })
      : linkOutcome({
          subtitle: m.activity_link_claimed_at({ name: partyName(claimer) }),
          badge: Option.none(),
          direction: "out",
          detail: m.activity_link_claimed_at_detail({
            name: partyName(claimer),
            date: closedOn(closedAt),
          }),
          claimer,
        });

const openLinkOutcome = () =>
  linkOutcome({
    subtitle: m.activity_link_open(),
    badge: Option.some(unclaimed()),
    direction: "out",
    detail: m.activity_link_open_detail(),
    open: true,
  });

const linkReceiptOutcome = (receipt: Receipt) =>
  Match.valueTags(receipt, {
    Pending: () =>
      linkOutcome({
        subtitle: m.activity_link_creating(),
        badge: Option.some(sending()),
        direction: "out",
        detail: m.activity_link_creating_detail(),
      }),
    Failed: () =>
      linkOutcome({
        subtitle: m.activity_link_not_created(),
        badge: Option.some(notSent()),
        direction: "unchanged",
        detail: m.activity_link_not_created_detail(),
      }),
    Settled: openLinkOutcome,
    Reserved: openLinkOutcome,
    Claimed: ({ by, closedAt, openedWallet }) =>
      claimedLinkOutcome(by, closedAt, openedWallet),
    Refunded: ({ closedAt }) =>
      linkOutcome({
        subtitle: m.activity_link_taken_back(),
        badge: Option.none(),
        direction: "unchanged",
        detail: m.activity_link_taken_back_detail({
          date: closedOn(closedAt),
        }),
      }),
  });

const paymentOutcome = (
  party: Party,
  outcome: Pick<Outcome, "badge" | "direction" | "detail"> & {
    readonly subtitle?: string;
  },
): Outcome => ({
  title: partyName(party),
  subtitle: outcome.subtitle ?? m.activity_you_sent(),
  badge: outcome.badge,
  direction: outcome.direction,
  detail: outcome.detail,
  media: party,
  counterparty: Option.some({ label: m.common_to(), party }),
  openLink: false,
});

const paymentReceiptOutcome = (receipt: Receipt, party: Party) => {
  const name = partyName(party);

  return Match.valueTags(receipt, {
    Pending: () =>
      paymentOutcome(party, {
        badge: Option.some(sending()),
        direction: "out",
        detail: m.activity_sending_detail(),
      }),
    Settled: () =>
      paymentOutcome(party, {
        badge: Option.none(),
        direction: "out",
        detail: m.activity_settled_detail({ name }),
      }),
    Reserved: () =>
      paymentOutcome(party, {
        badge: Option.some(awaitingAcceptance()),
        direction: "out",
        detail: m.activity_reserved_detail({ name }),
      }),
    Claimed: ({ closedAt }) =>
      paymentOutcome(party, {
        badge: Option.none(),
        direction: "out",
        detail: m.activity_claimed_detail({ name, date: closedOn(closedAt) }),
      }),
    Refunded: ({ closedAt }) =>
      paymentOutcome(party, {
        subtitle: m.activity_returned(),
        badge: Option.none(),
        direction: "unchanged",
        detail: m.activity_returned_detail({ date: closedOn(closedAt) }),
      }),
    Failed: ({ reason }) =>
      paymentOutcome(party, {
        badge: Option.some(notSent()),
        direction: "unchanged",
        detail: Match.value(reason).pipe(
          Match.when("expired", () => m.activity_expired_detail()),
          Match.when("rejected", () => m.activity_rejected_detail()),
          Match.exhaustive,
        ),
      }),
  });
};

const recipientParty = (recipient: ResolvedRecipient): Option.Option<Party> =>
  recipient instanceof LinkRecipient ? Option.none() : Option.some(recipient);

const sentEntry = ({ receipt, createdAt }: SentActivity): ShownEntry => {
  const outcome = Option.match(recipientParty(receipt.recipient), {
    onNone: () => linkReceiptOutcome(receipt),
    onSome: (party) => paymentReceiptOutcome(receipt, party),
  });

  return {
    ...outcome,
    amount: signedAmount(outcome.direction, receipt.amount, receipt.asset),
    memo: memoText(receipt.memo),
    createdAt,
  };
};

const receivedEntry = (
  entry: {
    from: Profile;
    amount: Amount;
    asset: Asset;
    createdAt: DateTime.Utc;
  },
  outcome: Pick<Outcome, "subtitle" | "badge" | "direction" | "detail">,
): ShownEntry => ({
  ...outcome,
  title: partyName(entry.from),
  media: entry.from,
  counterparty: Option.some({ label: m.activity_from(), party: entry.from }),
  openLink: false,
  amount: signedAmount(outcome.direction, entry.amount, entry.asset),
  memo: Option.none(),
  createdAt: entry.createdAt,
});

const receivedText = (
  from: Profile,
  paidRequest: Option.Option<PaymentRequestPaid>,
) =>
  Option.match(paidRequest, {
    onNone: () => ({
      subtitle: m.activity_received(),
      detail: m.activity_received_detail({ name: partyName(from) }),
    }),
    onSome: ({ note }) => ({
      subtitle: m.activity_paid_request(),
      detail:
        note === undefined
          ? m.activity_paid_request_detail({ name: partyName(from) })
          : m.activity_paid_request_noted({ name: partyName(from), note }),
    }),
  });

export const shownEntry = (
  entry: ActivityEntry,
  paidRequest: Option.Option<PaymentRequestPaid>,
): ShownEntry =>
  Match.valueTags(entry, {
    SentActivity: sentEntry,
    ReceivedActivity: (received) =>
      receivedEntry(received, {
        ...receivedText(received.from, paidRequest),
        badge: Option.none(),
        direction: "in",
      }),
    AwaitingAcceptanceActivity: (awaiting) =>
      receivedEntry(awaiting, {
        subtitle: m.activity_awaiting_receipt({ asset: awaiting.asset.code }),
        badge: Option.some(awaitingAcceptance()),
        direction: "unchanged",
        detail: m.activity_awaiting_receipt_detail(),
      }),
    TakenBackActivity: (takenBack) =>
      receivedEntry(takenBack, {
        subtitle: m.activity_sender_took_back(),
        badge: Option.none(),
        direction: "unchanged",
        detail: m.activity_sender_took_back_detail({
          name: partyName(takenBack.from),
          date: closedOn(takenBack.closedAt),
        }),
      }),
    ClaimedLinkActivity: (claimed) =>
      receivedEntry(claimed, {
        subtitle: m.activity_you_claimed(),
        badge: Option.none(),
        direction: "in",
        detail: m.activity_you_claimed_detail({
          name: partyName(claimed.from),
        }),
      }),
    DepositActivity: (deposit): ShownEntry => ({
      title: m.activity_deposit(),
      subtitle: m.activity_deposit_subtitle(),
      badge: Option.none(),
      direction: "in",
      detail: m.activity_deposit_detail(),
      media: deposit.from,
      counterparty: Option.some({
        label: m.activity_from(),
        party: deposit.from,
      }),
      amount: signedAmount("in", deposit.amount, deposit.asset),
      memo: Option.none(),
      createdAt: deposit.createdAt,
      openLink: false,
    }),
  });

export const paidRequestOf = (
  paidRequests: ReadonlyArray<PaidRequest>,
  entry: ActivityEntry,
) =>
  Option.map(
    Option.fromNullishOr(
      paidRequests.find(
        (paid) =>
          Predicate.isTagged(entry, "ReceivedActivity") &&
          paid.payment === entry.id,
      ),
    ),
    (paid) => paid.request,
  );

export const entryKey = (entry: ActivityEntry) => `${entry._tag}:${entry.id}`;

export const createdWhen = (createdAt: DateTime.Utc) => {
  const created = DateTime.toDate(createdAt);
  const today = new Date();

  const yesterday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 1,
  );

  const time = created.toLocaleTimeString(formattingLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  if (created.toDateString() === today.toDateString())
    return m.activity_today({ time });

  if (created.toDateString() === yesterday.toDateString())
    return m.activity_yesterday({ time });

  return created.toLocaleDateString(formattingLocale(), {
    day: "numeric",
    month: "short",
    year: created.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
};

export const createdAtLabel = (createdAt: DateTime.Utc) =>
  DateTime.toDate(createdAt).toLocaleString(formattingLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
