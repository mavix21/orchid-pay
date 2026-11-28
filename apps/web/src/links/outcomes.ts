import type {
  Asset,
  AssertionRejected,
  ConfirmPaymentLinkOutcome,
  CorruptDeviceWallet,
  PasskeyCancelled,
  PasskeyFailed,
  PaymentLinkCreated,
  PaymentReview,
  PaymentLinkTarget,
  PrfOutputMissing,
  ReclaimOutcome,
  WrongCredential,
  ResolvePaymentLinkOutcome,
  LatestPaymentLink,
  PaymentLinkRevealed,
  RevealPaymentLinkOutcome,
  WalletUnavailable,
} from "@workspace/wallet";
import * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { formattingLocale } from "@/locale/format";
import { amountLabel } from "@/send/money";
import type { DeviceFailure } from "@/send/use-wallet-task";
import { unavailableMessage } from "@/wallet/unavailable";
import { m } from "@/paraglide/messages";

export type CreateAction =
  | "once"
  | "again"
  | "edit"
  | "check"
  | "home"
  | "links"
  | "assets"
  | "elsewhere";

export type CheckAction = "check" | "home" | "links";

export type RecoverAction = "done" | "again" | "check" | "home";

export class LinkScreen<Action extends string> {
  constructor(
    readonly title: string,
    readonly message: string,
    readonly action: Action,
  ) {}
}

export type RecoverableLink = PaymentLinkTarget;

export const recoverable = ({
  unclaimedFunds,
  asset,
  amount,
}: RecoverableLink): RecoverableLink => ({ unclaimedFunds, asset, amount });

const thenUntouched = (sentence: string) => `${sentence} ${m.send_untouched()}`;

export const thenStillInLink = (sentence: string) =>
  `${sentence} ${m.link_still_there()}`;

const unavailable = (failure: WalletUnavailable, next: string) =>
  new LinkScreen(
    m.link_interrupted_title(),
    `${unavailableMessage(failure)} ${next}`,
    "check",
  );

const creationDeviceFailure = () =>
  new LinkScreen(m.common_device_failed_title(), m.link_check_first(), "check");

const unsupportedScreen = (
  reason:
    | "issuer_missing"
    | "self_issued"
    | "base_asset"
    | "authorization_required"
    | "clawback_enabled",
  code: string,
) => {
  const elsewhere = reason === "clawback_enabled";

  return new LinkScreen<CreateAction>(
    m.link_unsupported_title({ asset: code }),
    thenUntouched(
      `${m.link_unsupported_currency()} ${elsewhere ? m.link_unsupported_elsewhere() : m.link_unsupported_choose()}`,
    ),
    elsewhere ? "elsewhere" : "assets",
  );
};

const stillCreating = () =>
  new LinkScreen(
    m.link_still_creating_title(),
    m.link_still_creating(),
    "check",
  );

const busyCreating = () =>
  new LinkScreen(
    m.common_wait_title(),
    `${m.common_other_operation()} ${m.link_busy_creating()}`,
    "again",
  );

const busyRecovering = () =>
  new LinkScreen(m.common_wait_title(), m.link_busy_recovering(), "check");

const unconfirmed = () =>
  new LinkScreen(m.link_unconfirmed_title(), m.link_check_first(), "check");

const notCreated = () =>
  new LinkScreen(
    m.link_not_created_title(),
    thenUntouched(m.link_mismatched()),
    "home",
  );

export type CreateRefusal =
  | Exclude<
      ConfirmPaymentLinkOutcome,
      | PaymentLinkCreated
      | PaymentReview
      | PasskeyCancelled
      | PasskeyFailed
      | WrongCredential
      | AssertionRejected
    >
  | DeviceFailure;

export const createLinkResult = (
  outcome: CreateRefusal,
  asset: Asset,
): LinkScreen<CreateAction> =>
  Match.valueTags(outcome, {
    DeviceFailure: creationDeviceFailure,
    Pending: stillCreating,
    ApprovalOutstanding: ({ order }) =>
      Predicate.isTagged(order.to, "PaymentLink")
        ? new LinkScreen(
            m.link_last_creating_title(),
            m.link_last_creating(),
            "check",
          )
        : new LinkScreen(
            m.send_payment_in_progress_title(),
            m.link_busy_creating(),
            "again",
          ),
    DraftRejected: unconfirmed,
    NoTransfer: unconfirmed,
    Reserved: unconfirmed,
    Claimed: unconfirmed,
    Refunded: unconfirmed,
    PrfOutputMissing: () =>
      new LinkScreen(
        m.opening_prf_missing_title(),
        thenUntouched(m.send_passkey_unopened()),
        "home",
      ),
    LinkOutputMissing: () =>
      new LinkScreen(
        m.link_cannot_save_title(),
        thenUntouched(m.link_cannot_save()),
        "once",
      ),
    CorruptDeviceWallet: () =>
      new LinkScreen(
        m.opening_corrupt_title(),
        thenUntouched(m.corrupt_device_wallet()),
        "home",
      ),
    Failed: ({ reason }) =>
      new LinkScreen(
        m.link_not_created_title(),
        thenUntouched(
          reason === "expired"
            ? m.link_not_confirmed_in_time()
            : m.link_network_rejected(),
        ),
        "again",
      ),
    InsufficientBalance: ({ available }) =>
      new LinkScreen(
        m.link_insufficient_title({ asset: asset.code }),
        thenUntouched(
          m.link_insufficient({ amount: amountLabel(available, asset) }),
        ),
        "edit",
      ),
    UnclaimedFundsLimitReached: ({ limit }) =>
      new LinkScreen(
        m.link_limit_title({ limit }),
        thenUntouched(m.link_limit({ limit })),
        "links",
      ),
    AssetUnsupported: ({ reason }) => unsupportedScreen(reason, asset.code),
    SenderBusy: busyCreating,
    AssetBusy: busyCreating,
    NotOpened: () =>
      new LinkScreen(
        m.link_not_opened_title(),
        m.common_account_activating(),
        "home",
      ),
    InvalidAddress: notCreated,
    UnknownRecipient: notCreated,
    PhoneNotSupported: notCreated,
    ExternalMemoRequired: notCreated,
    MemoNotAllowed: notCreated,
    RecipientCannotReceive: notCreated,
    NoWallet: () =>
      new LinkScreen(m.common_no_wallet_title(), m.session_no_wallet(), "home"),
    UnsupportedDevice: () =>
      new LinkScreen(
        m.opening_corrupt_title(),
        m.device_cannot_read_key(),
        "home",
      ),
    Offline: (failure) => unavailable(failure, m.link_check_first()),
    ServerUnreachable: (failure) => unavailable(failure, m.link_check_first()),
    LedgerUnreachable: (failure) => unavailable(failure, m.link_check_first()),
    ServiceFailed: (failure) => unavailable(failure, m.link_check_first()),
    SessionRequired: (failure) => unavailable(failure, m.link_check_first()),
    RateLimited: (failure) => unavailable(failure, m.link_check_first()),
    InvalidResponse: (failure) => unavailable(failure, m.link_check_first()),
  });

const unprepared = () =>
  new LinkScreen(
    m.link_unprepared_title(),
    thenUntouched(m.link_try_again()),
    "again",
  );

const interrupted = (failure: WalletUnavailable) =>
  new LinkScreen(
    m.link_interrupted_title(),
    thenUntouched(unavailableMessage(failure)),
    "again",
  );

export const preparedLinkResult = (
  outcome: CreateRefusal,
  asset: Asset,
): LinkScreen<CreateAction> =>
  Match.value(outcome).pipe(
    Match.tags({
      DeviceFailure: unprepared,
      DraftRejected: unprepared,
      Offline: interrupted,
      ServerUnreachable: interrupted,
      LedgerUnreachable: interrupted,
      ServiceFailed: interrupted,
      SessionRequired: interrupted,
      RateLimited: interrupted,
      InvalidResponse: interrupted,
    }),
    Match.orElse((refusal) => createLinkResult(refusal, asset)),
  );

export type CheckRefusal =
  | Exclude<ResolvePaymentLinkOutcome, LatestPaymentLink>
  | DeviceFailure;

export const resolveLinkResult = (
  outcome: CheckRefusal,
): LinkScreen<CheckAction> =>
  Match.valueTags(outcome, {
    DeviceFailure: creationDeviceFailure,
    Pending: stillCreating,
    ApprovalOutstanding: stillCreating,
    PaymentLinkNotFound: () =>
      new LinkScreen(
        m.link_receipt_missing_title(),
        m.link_receipt_missing(),
        "home",
      ),
    PaymentLinkReceiptInvalid: () =>
      new LinkScreen(
        m.link_unconfirmed_title(),
        m.link_receipt_invalid(),
        "links",
      ),
    InvalidAddress: () =>
      new LinkScreen(
        m.opening_corrupt_title(),
        m.common_stored_key_invalid(),
        "home",
      ),
    NoWallet: () =>
      new LinkScreen(m.common_no_wallet_title(), m.session_no_wallet(), "home"),
    UnsupportedDevice: () =>
      new LinkScreen(
        m.opening_corrupt_title(),
        m.device_cannot_read_key(),
        "home",
      ),
    Offline: (failure) => unavailable(failure, m.link_check_first()),
    ServerUnreachable: (failure) => unavailable(failure, m.link_check_first()),
    LedgerUnreachable: (failure) => unavailable(failure, m.link_check_first()),
    ServiceFailed: (failure) => unavailable(failure, m.link_check_first()),
    SessionRequired: (failure) => unavailable(failure, m.link_check_first()),
    RateLimited: (failure) => unavailable(failure, m.link_check_first()),
    InvalidResponse: (failure) => unavailable(failure, m.link_check_first()),
  });

const cannotRecover = (reason: string) =>
  new LinkScreen(
    m.link_cannot_recover_title(),
    thenStillInLink(reason),
    "done",
  );

const recoverAgain = () =>
  new LinkScreen(
    m.link_recover_failed_title(),
    thenStillInLink(m.link_try_again()),
    "again",
  );

export type ReclaimConclusion =
  | ReclaimOutcome
  | PrfOutputMissing
  | CorruptDeviceWallet
  | DeviceFailure;

export const reclaimResult = (
  outcome: ReclaimConclusion,
  link: RecoverableLink,
): LinkScreen<RecoverAction> => {
  const code = link.asset.code;
  const amount = amountLabel(link.amount, link.asset);

  return Match.valueTags(outcome, {
    DeviceFailure: () =>
      new LinkScreen(
        m.common_device_failed_title(),
        m.link_recheck_recovery(),
        "check",
      ),
    AssetSettled: () =>
      new LinkScreen(
        m.link_recovered_title(),
        m.link_recovered({ amount }),
        "done",
      ),
    AssetPending: () =>
      new LinkScreen(
        m.link_recovery_pending_title(),
        m.link_recovery_pending(),
        "check",
      ),
    AssetFailed: () =>
      new LinkScreen(
        m.link_recovery_not_done_title(),
        m.link_recovery_not_done(),
        "again",
      ),
    UnclaimedFundsGone: ({ status }) =>
      Match.value(status).pipe(
        Match.when(
          "reclaimed",
          () =>
            new LinkScreen(
              m.link_already_recovered_title(),
              m.link_recovered({ amount }),
              "done",
            ),
        ),
        Match.when(
          "claimed",
          () =>
            new LinkScreen(
              m.link_claimed_title(),
              m.link_claimed({ amount }),
              "done",
            ),
        ),
        Match.when(
          "clawed_back",
          () =>
            new LinkScreen(
              m.link_clawed_back_title(),
              m.link_clawed_back({ asset: code, amount }),
              "done",
            ),
        ),
        Match.when(
          "unresolved",
          () =>
            new LinkScreen(
              m.link_unresolved_title(),
              m.link_unresolved(),
              "done",
            ),
        ),
        Match.exhaustive,
      ),
    RecipientCannotReceive: ({ reason }) =>
      cannotRecover(
        Match.value(reason).pipe(
          Match.when("no_account", () => m.link_own_inactive()),
          Match.when("no_trustline", () =>
            m.link_own_cannot_receive({ asset: code }),
          ),
          Match.when("not_authorized", () => m.link_own_not_authorized()),
          Match.when("no_capacity", () =>
            m.link_own_no_capacity({ asset: code }),
          ),
          Match.exhaustive,
        ),
      ),
    TrustlineLimitReached: ({ limit }) =>
      cannotRecover(m.link_asset_limit({ limit, asset: code })),
    AssetUnsupported: () =>
      cannotRecover(m.link_own_cannot_receive({ asset: code })),
    NotClaimable: ({ claimableAt }) =>
      Option.match(claimableAt, {
        onNone: recoverAgain,
        onSome: (at) =>
          new LinkScreen(
            m.link_not_yet_recoverable_title(),
            thenStillInLink(
              m.link_recoverable_from({
                date: DateTime.toDate(at).toLocaleString(formattingLocale(), {
                  dateStyle: "long",
                  timeStyle: "short",
                }),
              }),
            ),
            "done",
          ),
      }),
    SenderBusy: busyRecovering,
    AssetBusy: busyRecovering,
    LinkUnclaimable: recoverAgain,
    Unchanged: recoverAgain,
    TrustlineNotEmpty: recoverAgain,
    DraftRejected: () =>
      new LinkScreen(
        m.link_operation_unconfirmed_title(),
        m.link_recheck_recovery(),
        "check",
      ),
    PrfOutputMissing: () =>
      new LinkScreen(
        m.opening_prf_missing_title(),
        thenStillInLink(m.send_passkey_unopened()),
        "home",
      ),
    CorruptDeviceWallet: () =>
      new LinkScreen(
        m.opening_corrupt_title(),
        thenStillInLink(m.corrupt_device_wallet()),
        "home",
      ),
    NotOpened: () =>
      new LinkScreen(
        m.link_cannot_recover_yet_title(),
        m.common_account_activating(),
        "home",
      ),
    InvalidAddress: () =>
      new LinkScreen(
        m.opening_corrupt_title(),
        m.common_stored_key_invalid(),
        "home",
      ),
    NoWallet: () =>
      new LinkScreen(m.common_no_wallet_title(), m.session_no_wallet(), "home"),
    UnsupportedDevice: () =>
      new LinkScreen(
        m.opening_corrupt_title(),
        m.device_cannot_read_key(),
        "home",
      ),
    Offline: (failure) => unavailable(failure, m.link_recheck_recovery()),
    ServerUnreachable: (failure) =>
      unavailable(failure, m.link_recheck_recovery()),
    LedgerUnreachable: (failure) =>
      unavailable(failure, m.link_recheck_recovery()),
    ServiceFailed: (failure) => unavailable(failure, m.link_recheck_recovery()),
    SessionRequired: (failure) =>
      unavailable(failure, m.link_recheck_recovery()),
    RateLimited: (failure) => unavailable(failure, m.link_recheck_recovery()),
    InvalidResponse: (failure) =>
      unavailable(failure, m.link_recheck_recovery()),
  });
};

export type RevealRefusal =
  | Exclude<RevealPaymentLinkOutcome, PaymentLinkRevealed>
  | DeviceFailure;

const cannotOpen = (reason: string) =>
  new LinkScreen<RevealAction>(
    m.link_cannot_open_title(),
    thenStillInLink(reason),
    "recover",
  );

const retryOpen = (reason: string) =>
  new LinkScreen<RevealAction>(
    m.link_cannot_open_title(),
    thenStillInLink(reason),
    "retry",
  );

export type RevealAction = "retry" | "recover";

export const revealResult = (
  outcome: RevealRefusal,
): LinkScreen<RevealAction> =>
  Match.valueTags(outcome, {
    PasskeyCancelled: () => retryOpen(m.link_open_passkey_cancelled()),
    PasskeyFailed: () => retryOpen(m.passkey_failed()),
    WrongCredential: () => retryOpen(m.link_open_wrong_credential()),
    AssertionRejected: () => retryOpen(m.link_open_assertion_rejected()),
    PrfOutputMissing: () => cannotOpen(m.link_open_prf_missing()),
    SavedLinkMissing: () => cannotOpen(m.link_saved_missing()),
    SavedLinkCorrupt: () => cannotOpen(m.link_saved_corrupt()),
    CorruptDeviceWallet: () => cannotOpen(m.corrupt_device_wallet()),
    NoWallet: () => cannotOpen(m.session_no_wallet()),
    UnsupportedDevice: () => cannotOpen(m.link_open_unsupported()),
    DeviceFailure: () => retryOpen(m.link_device_failed()),
    Offline: (failure) => retryOpen(unavailableMessage(failure)),
    ServerUnreachable: (failure) => retryOpen(unavailableMessage(failure)),
    LedgerUnreachable: (failure) => retryOpen(unavailableMessage(failure)),
    ServiceFailed: (failure) => retryOpen(unavailableMessage(failure)),
    SessionRequired: (failure) => retryOpen(unavailableMessage(failure)),
    RateLimited: (failure) => retryOpen(unavailableMessage(failure)),
    InvalidResponse: (failure) => retryOpen(unavailableMessage(failure)),
  });
