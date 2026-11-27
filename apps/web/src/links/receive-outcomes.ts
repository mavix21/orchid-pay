import type {
  ConfirmLinkReceiveOutcome,
  LinkReceiveReview,
  WalletUnavailable,
} from "@workspace/wallet";
import * as Match from "effect/Match";

import type { DeviceFailure } from "@/send/use-wallet-task";
import { LinkScreen, thenStillInLink } from "@/links/outcomes";
import { retryable, unavailableMessage } from "@/wallet/unavailable";
import { m } from "@/paraglide/messages";

export type ReceiveAction = "home" | "again" | "check" | "done";

export type ReceiveConclusion =
  | Exclude<ConfirmLinkReceiveOutcome, LinkReceiveReview>
  | DeviceFailure;

const used = () =>
  new LinkScreen<ReceiveAction>(m.claim_used_title(), m.claim_used(), "done");

const unresolved = () =>
  new LinkScreen<ReceiveAction>(
    m.claim_unresolved_title(),
    m.claim_unresolved(),
    "done",
  );

const unrecognized = () =>
  new LinkScreen<ReceiveAction>(
    m.claim_unrecognized_title(),
    m.claim_unrecognized(),
    "done",
  );

const checking = () =>
  new LinkScreen<ReceiveAction>(
    m.claim_checking_title(),
    m.claim_checking(),
    "check",
  );

const notReceived = (message: string, action: ReceiveAction = "again") =>
  new LinkScreen<ReceiveAction>(m.claim_not_received_title(), message, action);

const unavailable = (failure: WalletUnavailable) =>
  notReceived(
    thenStillInLink(unavailableMessage(failure)),
    retryable(failure) ? "again" : "done",
  );

export const receiveScreen = (
  outcome: ReceiveConclusion,
  received: string,
): LinkScreen<ReceiveAction> =>
  Match.valueTags(outcome, {
    AssetSettled: () =>
      new LinkScreen<ReceiveAction>(
        m.claim_received_title({ amount: received }),
        m.claim_received(),
        "home",
      ),
    AssetPending: checking,
    PaymentLinkChecking: checking,
    AssetFailed: () => notReceived(m.claim_incomplete_operation(), "check"),
    UnclaimedFundsGone: ({ status }) =>
      status === "unresolved" ? unresolved() : used(),
    PaymentLinkUsed: used,
    PaymentLinkUnresolved: unresolved,
    PaymentLinkUnrecognized: unrecognized,
    PaymentLinkNotFound: () =>
      new LinkScreen<ReceiveAction>(
        m.claim_not_found_title(),
        m.claim_not_found(),
        "done",
      ),
    LinkCodeMismatch: () =>
      new LinkScreen<ReceiveAction>(
        m.receive_link_incomplete_title(),
        m.claim_reopen(),
        "done",
      ),
    InvalidAddress: () =>
      new LinkScreen<ReceiveAction>(
        m.claim_invalid_title(),
        m.claim_reopen(),
        "done",
      ),
    LinkUnclaimable: () =>
      new LinkScreen<ReceiveAction>(
        m.claim_failed_title(),
        m.claim_still_available(),
        "done",
      ),
    RecipientCannotReceive: () =>
      notReceived(thenStillInLink(m.claim_currency_unsupported()), "done"),
    AssetUnsupported: () =>
      notReceived(thenStillInLink(m.claim_currency_unsupported()), "done"),
    TrustlineLimitReached: () =>
      notReceived(thenStillInLink(m.claim_currency_unsupported()), "done"),
    NotOpened: () =>
      notReceived(thenStillInLink(m.common_account_activating())),
    SenderBusy: () => notReceived(thenStillInLink(m.common_other_operation())),
    AssetBusy: () => notReceived(thenStillInLink(m.common_other_operation())),
    NotClaimable: () => notReceived(thenStillInLink(m.link_try_again())),
    Unchanged: () => notReceived(thenStillInLink(m.link_try_again())),
    TrustlineNotEmpty: () => notReceived(thenStillInLink(m.link_try_again())),
    DraftRejected: () =>
      notReceived(thenStillInLink(m.claim_request_changed())),
    NoWallet: () => notReceived(thenStillInLink(m.session_no_wallet())),
    UnsupportedDevice: () =>
      notReceived(thenStillInLink(m.device_cannot_store_key()), "done"),
    PasskeyCancelled: () =>
      notReceived(thenStillInLink(m.claim_passkey_cancelled())),
    PasskeyFailed: () => notReceived(thenStillInLink(m.claim_passkey_failed())),
    WrongCredential: () =>
      notReceived(thenStillInLink(m.claim_wrong_credential())),
    AssertionRejected: () =>
      notReceived(thenStillInLink(m.claim_assertion_rejected())),
    PrfOutputMissing: () =>
      notReceived(thenStillInLink(m.claim_prf_missing()), "done"),
    CorruptDeviceWallet: () =>
      notReceived(thenStillInLink(m.corrupt_device_wallet()), "done"),
    DeviceFailure: () =>
      notReceived(thenStillInLink(m.link_device_failed()), "check"),
    Offline: unavailable,
    ServerUnreachable: unavailable,
    LedgerUnreachable: unavailable,
    ServiceFailed: unavailable,
    SessionRequired: unavailable,
    RateLimited: unavailable,
    InvalidResponse: unavailable,
  });

export const receiveRefusal = (outcome: ReceiveConclusion) => {
  const screen = receiveScreen(outcome, "");

  return `${screen.title}. ${screen.message}`;
};
