import { WalletUnavailable } from "@workspace/wallet";
import * as Match from "effect/Match";
import * as Schema from "effect/Schema";
import { m } from "@/paraglide/messages";

export class UnavailableNotice {
  constructor(
    readonly message: string,
    readonly actionable: boolean,
  ) {}
}

export const unavailableNotice = (failure: WalletUnavailable) =>
  Match.valueTags(failure, {
    Offline: () => new UnavailableNotice(m.unavailable_offline(), true),
    ServerUnreachable: () =>
      new UnavailableNotice(m.unavailable_server(), true),
    LedgerUnreachable: () =>
      new UnavailableNotice(m.unavailable_ledger(), true),
    ServiceFailed: () => new UnavailableNotice(m.unavailable_service(), false),
    SessionRequired: () => new UnavailableNotice(m.unavailable_session(), true),
    RateLimited: () =>
      new UnavailableNotice(m.unavailable_rate_limited(), true),
    InvalidResponse: () =>
      new UnavailableNotice(m.unavailable_invalid_response(), false),
  });

export const unavailableMessage = (failure: WalletUnavailable) =>
  unavailableNotice(failure).message;

const isUnavailable = Schema.is(WalletUnavailable);

export const retryable = (outcome: { readonly _tag: string }) =>
  !isUnavailable(outcome) || unavailableNotice(outcome).actionable;
