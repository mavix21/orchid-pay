import { Link, useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import type {
  InvalidAddress,
  NeedsReopening,
  UnsupportedDevice,
  WalletUnavailable,
} from "@workspace/wallet";
import * as Match from "effect/Match";

import { ScreenActions, ScreenNote, ScreenStatus } from "@/components/screen";
import { UnavailableNotice, unavailableNotice } from "@/wallet/unavailable";
import { m } from "@/paraglide/messages";

export type UnavailableOverview =
  | NeedsReopening
  | InvalidAddress
  | UnsupportedDevice
  | WalletUnavailable;

export function SendUnavailable({
  overview,
}: {
  overview: UnavailableOverview;
}) {
  const router = useRouter();

  const notice = Match.valueTags(overview, {
    NeedsReopening: ({ profile }) =>
      new UnavailableNotice(
        m.send_needs_reopening({ username: profile.username }),
        false,
      ),
    InvalidAddress: () =>
      new UnavailableNotice(m.common_stored_key_invalid(), false),
    UnsupportedDevice: () =>
      new UnavailableNotice(m.device_cannot_read_key(), false),
    Offline: unavailableNotice,
    ServerUnreachable: unavailableNotice,
    LedgerUnreachable: unavailableNotice,
    ServiceFailed: unavailableNotice,
    SessionRequired: unavailableNotice,
    RateLimited: unavailableNotice,
    InvalidResponse: unavailableNotice,
  });

  return (
    <>
      <ScreenStatus title={m.send_unavailable_title()}>
        <ScreenNote>{notice.message}</ScreenNote>
      </ScreenStatus>
      <ScreenActions>
        {notice.actionable ? (
          <Button className="w-full" onClick={() => void router.invalidate()}>
            {m.common_retry()}
          </Button>
        ) : null}
        <Button
          className="w-full"
          variant={notice.actionable ? "secondary" : "default"}
          nativeButton={false}
          render={<Link to="/home" />}
        >
          {m.common_back_home()}
        </Button>
      </ScreenActions>
    </>
  );
}
