import type { SessionRefusal } from "@workspace/wallet";
import * as Match from "effect/Match";

import { unavailableMessage } from "./unavailable";
import { m } from "@/paraglide/messages";

export const sessionRefusal = (outcome: SessionRefusal) =>
  Match.valueTags(outcome, {
    PasskeyCancelled: () => m.session_passkey_cancelled(),
    PasskeyFailed: () => m.passkey_failed(),
    WrongCredential: () => m.session_wrong_credential(),
    AssertionRejected: () => m.session_assertion_rejected(),
    AssertionRefused: () => m.session_assertion_refused(),
    ChallengeRefused: () => m.session_challenge_refused(),
    NoBackup: () => m.session_no_backup(),
    NoWallet: () => m.session_no_wallet(),
    UnsupportedDevice: () => m.device_cannot_read_key(),
    CorruptDeviceWallet: () => m.corrupt_device_wallet(),
    Offline: unavailableMessage,
    ServerUnreachable: unavailableMessage,
    LedgerUnreachable: unavailableMessage,
    ServiceFailed: unavailableMessage,
    SessionRequired: unavailableMessage,
    RateLimited: unavailableMessage,
    InvalidResponse: unavailableMessage,
  });
