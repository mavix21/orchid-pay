import type {
  Asset,
  ConfirmExternalLinkOutcome,
  DestinationAddress,
  ExternalLinkReview,
  WalletUnavailable,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";

import { LinkScreen, thenStillInLink } from "@/links/outcomes";
import { shortAddress } from "@/send/money";
import type { DeviceFailure } from "@/send/use-wallet-task";
import { unavailableMessage } from "@/wallet/unavailable";

import { ExternalClaimFieldProblem } from "./external-claim-intent";

import { m } from "@/paraglide/messages";

export type ExternalClaimAction = "check" | "done";

export type ExternalClaimConclusion =
  | Exclude<ConfirmExternalLinkOutcome, ExternalLinkReview>
  | DeviceFailure;

export type ExternalClaimResult = Data.TaggedEnum<{
  Field: { readonly problem: ExternalClaimFieldProblem };
  RetryLookup: { readonly message: string };
  Concluded: {
    readonly outcome: string;
    readonly screen: LinkScreen<ExternalClaimAction>;
  };
}>;

export const ExternalClaimResult = Data.taggedEnum<ExternalClaimResult>();

const lookupFailedMessage = () => thenStillInLink(m.external_lookup_failed());

const used = () =>
  new LinkScreen<ExternalClaimAction>(
    m.claim_used_title(),
    m.claim_used(),
    "done",
  );

const unresolved = () =>
  new LinkScreen<ExternalClaimAction>(
    m.claim_unresolved_title(),
    m.claim_unresolved(),
    "done",
  );

const unrecognized = () =>
  new LinkScreen<ExternalClaimAction>(
    m.claim_unrecognized_title(),
    m.claim_unrecognized(),
    "done",
  );

const checking = () =>
  new LinkScreen<ExternalClaimAction>(
    m.claim_checking_title(),
    m.claim_checking(),
    "check",
  );

const notSent = (message: string, action: ExternalClaimAction = "check") =>
  new LinkScreen<ExternalClaimAction>(
    m.external_not_sent_title(),
    message,
    action,
  );

const concluded = (
  outcome: ExternalClaimConclusion,
  screen: LinkScreen<ExternalClaimAction>,
) => ExternalClaimResult.Concluded({ outcome: outcome._tag, screen });

const fieldProblem = (field: "destination" | "memo", message: string) =>
  ExternalClaimResult.Field({
    problem: new ExternalClaimFieldProblem(field, message),
  });

const mapResult = (
  outcome: ExternalClaimConclusion,
  asset: Asset,
  mode:
    | { readonly kind: "review" }
    | {
        readonly kind: "confirm";
        readonly sent: string;
        readonly destination: DestinationAddress;
      },
): ExternalClaimResult => {
  const code = asset.code;

  const onUnavailable = (failure: WalletUnavailable) =>
    mode.kind === "review"
      ? ExternalClaimResult.RetryLookup({ message: lookupFailedMessage() })
      : concluded(
          outcome,
          notSent(thenStillInLink(unavailableMessage(failure)), "check"),
        );

  return Match.valueTags(outcome, {
    ExternalLinkSettled: () =>
      concluded(
        outcome,
        new LinkScreen<ExternalClaimAction>(
          m.send_sent(),
          mode.kind === "confirm"
            ? m.external_sent({
                amount: mode.sent,
                address: shortAddress(mode.destination),
              })
            : m.external_sent_unknown(),
          "done",
        ),
      ),
    ExternalLinkPending: () => concluded(outcome, checking()),
    PaymentLinkChecking: () => concluded(outcome, checking()),
    ExternalLinkFailed: () =>
      concluded(outcome, notSent(m.claim_incomplete_operation(), "check")),
    UnclaimedFundsGone: ({ status }) =>
      concluded(outcome, status === "unresolved" ? unresolved() : used()),
    PaymentLinkUsed: () => concluded(outcome, used()),
    PaymentLinkUnresolved: () => concluded(outcome, unresolved()),
    PaymentLinkUnrecognized: () => concluded(outcome, unrecognized()),
    PaymentLinkNotFound: () =>
      concluded(
        outcome,
        new LinkScreen<ExternalClaimAction>(
          m.claim_not_found_title(),
          m.claim_not_found(),
          "done",
        ),
      ),
    LinkCodeMismatch: () =>
      concluded(
        outcome,
        new LinkScreen<ExternalClaimAction>(
          m.receive_link_incomplete_title(),
          m.claim_reopen(),
          "done",
        ),
      ),
    InvalidAddress: () =>
      fieldProblem("destination", m.common_address_invalid()),
    ExternalMemoRequired: () =>
      fieldProblem("memo", m.external_deposit_needs_memo()),
    MemoNotAllowed: () => fieldProblem("memo", m.external_memo_not_allowed()),
    RecipientCannotReceive: ({ reason }) =>
      fieldProblem(
        "destination",
        Match.value(reason).pipe(
          Match.when("no_account", () =>
            m.common_account_cannot_receive({ asset: code }),
          ),
          Match.when("not_authorized", () =>
            m.common_recipient_not_authorized({ asset: code }),
          ),
          Match.when("no_capacity", () =>
            m.common_recipient_no_capacity({ asset: code }),
          ),
          Match.exhaustive,
        ),
      ),
    LinkUnclaimable: ({ reason }) =>
      Match.value(reason).pipe(
        Match.when("destination_is_link", () =>
          fieldProblem("destination", m.external_destination_is_link()),
        ),
        Match.when("link_account_unexpected", () =>
          concluded(
            outcome,
            new LinkScreen<ExternalClaimAction>(
              m.claim_failed_title(),
              m.claim_still_available(),
              "done",
            ),
          ),
        ),
        Match.exhaustive,
      ),
    NotClaimable: () =>
      concluded(outcome, notSent(thenStillInLink(m.link_try_again()))),
    DraftRejected: () =>
      concluded(outcome, notSent(thenStillInLink(m.claim_request_changed()))),
    DeviceFailure: () =>
      mode.kind === "review"
        ? ExternalClaimResult.RetryLookup({ message: lookupFailedMessage() })
        : concluded(
            outcome,
            notSent(thenStillInLink(m.link_device_failed()), "check"),
          ),
    Offline: onUnavailable,
    ServerUnreachable: onUnavailable,
    LedgerUnreachable: onUnavailable,
    ServiceFailed: onUnavailable,
    SessionRequired: onUnavailable,
    RateLimited: onUnavailable,
    InvalidResponse: onUnavailable,
  });
};

export const reviewExternalResult = (
  outcome: ExternalClaimConclusion,
  asset: Asset,
) => mapResult(outcome, asset, { kind: "review" });

export const confirmExternalResult = (
  outcome: ExternalClaimConclusion,
  asset: Asset,
  sent: string,
  destination: DestinationAddress,
) => mapResult(outcome, asset, { kind: "confirm", sent, destination });
