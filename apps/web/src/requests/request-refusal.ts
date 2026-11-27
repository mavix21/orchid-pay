import type {
  NoWallet,
  NotOpened,
  UnsupportedDevice,
  WalletUnavailable,
} from "@workspace/wallet";
import * as Match from "effect/Match";

import type { DeviceFailure } from "@/send/use-wallet-task";
import { unavailableMessage } from "@/wallet/unavailable";
import { m } from "@/paraglide/messages";

export type RequestRefusal =
  | NotOpened
  | NoWallet
  | UnsupportedDevice
  | WalletUnavailable
  | DeviceFailure;

export const requestRefusal = (refusal: RequestRefusal) =>
  Match.valueTags(refusal, {
    NotOpened: () => m.payment_request_not_opened(),
    NoWallet: () => m.session_no_wallet(),
    UnsupportedDevice: () => m.device_cannot_read_key(),
    DeviceFailure: () => m.payment_request_device_failed(),
    Offline: unavailableMessage,
    ServerUnreachable: unavailableMessage,
    LedgerUnreachable: unavailableMessage,
    ServiceFailed: unavailableMessage,
    SessionRequired: unavailableMessage,
    RateLimited: unavailableMessage,
    InvalidResponse: unavailableMessage,
  });
