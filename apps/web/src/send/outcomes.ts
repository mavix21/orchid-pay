import {
  type Asset,
  Profile,
  type Receipt,
  type ResolvedRecipient,
  type ResumeOutcome,
  type TransferOrder,
} from "@workspace/wallet";
import * as Match from "effect/Match";

import { amountLabel, shortAddress } from "./money";
import { FieldProblem } from "./intent";

import { m } from "@/paraglide/messages";

export type NextAction = "done" | "home" | "retry" | "wait" | "check";

export class SendScreen {
  constructor(
    readonly title: string,
    readonly message: string,
    readonly action: NextAction,
    readonly outstanding?: TransferOrder,
  ) {}
}

export type SendResult = FieldProblem | SendScreen;

const recipientName = (recipient: ResolvedRecipient) =>
  recipient instanceof Profile
    ? `@${recipient.username}`
    : shortAddress(recipient.address);

const accepting = (recipient: ResolvedRecipient) =>
  m.send_accepting({ recipient: recipientName(recipient) });

const thenMaybeMoving = (sentence: string) =>
  `${sentence} ${m.send_maybe_moving()}`;

export const deviceFailure = () =>
  new SendScreen(m.common_device_failed_title(), m.send_maybe_moving(), "home");

export const sendResult = (
  outcome: ResumeOutcome | Receipt,
  asset: Asset,
): SendResult =>
  Match.valueTags(outcome, {
    Settled: (settled) =>
      new SendScreen(
        m.send_sent(),
        settled.unclaimedFunds === undefined
          ? m.send_amount_to({
              amount: amountLabel(settled.amount, settled.asset),
              recipient: recipientName(settled.recipient),
            })
          : accepting(settled.recipient),
        "done",
      ),
    Reserved: ({ recipient }) =>
      new SendScreen(m.send_sent(), accepting(recipient), "done"),
    Claimed: ({ recipient }) =>
      new SendScreen(
        m.send_sent(),
        m.send_claimed({ recipient: recipientName(recipient) }),
        "done",
      ),
    Refunded: ({ recipient }) =>
      new SendScreen(
        m.send_refunded_title(),
        m.send_refunded({ recipient: recipientName(recipient) }),
        "done",
      ),
    Failed: ({ reason }) =>
      new SendScreen(
        m.activity_not_sent(),
        `${reason === "expired" ? m.send_expired() : m.send_rejected()} ${m.send_untouched()}`,
        "retry",
      ),
    Pending: () =>
      new SendScreen(m.common_sending(), m.send_pending(), "check"),
    NotOpened: () =>
      new SendScreen(
        m.send_not_opened_title(),
        m.common_account_activating(),
        "home",
      ),
    UnknownRecipient: ({ username }) =>
      new FieldProblem("recipient", m.send_unknown_recipient({ username })),
    InvalidAddress: () =>
      new FieldProblem("recipient", m.common_address_invalid()),
    ExternalMemoRequired: () =>
      new FieldProblem("memo", m.send_destination_needs_memo()),
    MemoNotAllowed: ({ reason }) =>
      new FieldProblem(
        "memo",
        reason === "muxed"
          ? m.send_memo_not_allowed_address()
          : m.send_memo_not_allowed_orchid(),
      ),
    RecipientCannotReceive: ({ reason }) =>
      new FieldProblem(
        "recipient",
        Match.value(reason).pipe(
          Match.whenOr("no_account", "no_trustline", () =>
            m.common_account_cannot_receive({ asset: asset.code }),
          ),
          Match.when("not_authorized", () =>
            m.common_recipient_not_authorized({ asset: asset.code }),
          ),
          Match.when("no_capacity", () =>
            m.common_recipient_no_capacity({ asset: asset.code }),
          ),
          Match.exhaustive,
        ),
      ),
    InsufficientBalance: ({ available }) =>
      new FieldProblem(
        "amount",
        m.common_amount_available({ amount: amountLabel(available, asset) }),
      ),
    UnclaimedFundsLimitReached: ({ limit }) =>
      new SendScreen(
        m.send_unclaimed_limit_title(),
        m.send_unclaimed_limit({ limit }),
        "home",
      ),
    AssetUnsupported: () =>
      new SendScreen(m.activity_not_sent(), m.send_untouched(), "home"),
    SenderBusy: () =>
      new SendScreen(m.common_wait_title(), m.common_other_operation(), "wait"),
    AssetBusy: () =>
      new SendScreen(m.common_wait_title(), m.common_other_operation(), "wait"),
    PhoneNotSupported: () => new FieldProblem("recipient", m.send_phone_soon()),
    ApprovalOutstanding: ({ order }) =>
      new SendScreen(
        m.send_payment_in_progress_title(),
        m.send_approval_outstanding(),
        "retry",
        order,
      ),
    DraftRejected: () =>
      new SendScreen(
        m.send_draft_rejected_title(),
        `${m.send_draft_rejected()} ${m.send_untouched()}`,
        "retry",
      ),
    Offline: () =>
      new SendScreen(m.send_offline_title(), m.send_offline(), "retry"),
    ServerUnreachable: () =>
      new SendScreen(
        m.send_server_unreachable_title(),
        m.send_unreachable(),
        "retry",
      ),
    LedgerUnreachable: () =>
      new SendScreen(
        m.send_ledger_unreachable_title(),
        m.send_unreachable(),
        "retry",
      ),
    ServiceFailed: () =>
      new SendScreen(
        m.send_service_failed_title(),
        thenMaybeMoving(m.send_service_failed()),
        "home",
      ),
    SessionRequired: () =>
      new SendScreen(
        m.send_session_title(),
        thenMaybeMoving(m.send_session()),
        "retry",
      ),
    RateLimited: () =>
      new SendScreen(
        m.send_rate_limited_title(),
        thenMaybeMoving(m.send_rate_limited()),
        "retry",
      ),
    InvalidResponse: () =>
      new SendScreen(
        m.send_invalid_response_title(),
        m.send_maybe_moving(),
        "home",
      ),
    NoWallet: () =>
      new SendScreen(m.common_no_wallet_title(), m.session_no_wallet(), "home"),
    UnsupportedDevice: () =>
      new SendScreen(
        m.opening_corrupt_title(),
        m.device_cannot_read_key(),
        "home",
      ),
    NoTransfer: () =>
      new SendScreen(m.send_no_transfer_title(), m.send_no_transfer(), "home"),
  });

export const outstandingLabel = (order: TransferOrder) =>
  m.send_amount_to({
    amount: amountLabel(order.amount, order.asset),
    recipient: Match.valueTags(order.to, {
      Username: ({ value }) => `@${value}`,
      Address: ({ value }) => shortAddress(value),
      PaymentLink: ({ value }) => shortAddress(value),
      Phone: ({ value }) => value,
    }),
  });
