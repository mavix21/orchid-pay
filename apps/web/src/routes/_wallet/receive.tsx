import { XIcon } from "lucide-react";
import {
  Link,
  createFileRoute,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import type { DeviceOverview, Profile } from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import { OrchidPending } from "@/components/orchid-pending";
import {
  Screen,
  ScreenActions,
  ScreenNote,
  ScreenStatus,
} from "@/components/screen";
import { TopNav } from "@/components/top-nav";
import { DepositAddress } from "@/receive/deposit-address";
import { type OpeningCopy, OpeningFlow } from "@/wallet/opening-flow";
import { UnavailableNotice, unavailableNotice } from "@/wallet/unavailable";
import { m } from "@/paraglide/messages";

const depositCopy = (): OpeningCopy => ({
  preparing: m.deposit_preparing(),
  confirming: m.deposit_preparing(),
  title: m.opening_title(),
  explanation: m.deposit_opening_explanation(),
  action: m.opening_action(),
});

class Unopened extends Data.TaggedClass("Unopened")<{
  readonly profile: Profile;
}> {}

const shownReceive = (overview: DeviceOverview) =>
  Match.value(overview).pipe(
    Match.tag("NoWallet", () => {
      throw redirect({ to: "/", replace: true });
    }),
    Match.tag("NotOpened", ({ profile }) =>
      Option.match(profile, {
        onNone: () => {
          throw redirect({ to: "/create-account", replace: true });
        },
        onSome: (owner) => new Unopened({ profile: owner }),
      }),
    ),
    Match.orElse((shown) => shown),
  );

export const Route = createFileRoute("/_wallet/receive")({
  ssr: false,
  pendingMs: 0,
  pendingComponent: () => (
    <ReceiveFrame>
      <OrchidPending title={m.deposit_preparing()} />
    </ReceiveFrame>
  ),
  loader: async ({ context }) =>
    shownReceive(await context.walletClient.overview()),
  component: Receive,
});

function ReceiveFrame({ children }: { children: React.ReactNode }) {
  return (
    <Screen>
      <TopNav
        title={m.deposit_title()}
        label={m.common_close()}
        icon={<XIcon absoluteStrokeWidth />}
        link={<Link to="/home" />}
      />
      {children}
    </Screen>
  );
}

function Receive() {
  const router = useRouter();
  const shown = Route.useLoaderData();

  const opening = (username: string) => (
    <OpeningFlow
      username={username}
      copy={depositCopy()}
      onOpened={() => void router.invalidate()}
    />
  );

  return (
    <ReceiveFrame>
      {Match.valueTags(shown, {
        Holding: ({ profile }) => <DepositAddress address={profile.address} />,
        Unopened: ({ profile }) => opening(profile.username),
        NeedsReopening: ({ profile }) => opening(profile.username),
        InvalidAddress: () => (
          <ReceiveUnavailable
            notice={new UnavailableNotice(m.common_stored_key_invalid(), false)}
          />
        ),
        UnsupportedDevice: () => (
          <ReceiveUnavailable
            notice={new UnavailableNotice(m.device_cannot_read_key(), false)}
          />
        ),
        Offline: (failure) => (
          <ReceiveUnavailable notice={unavailableNotice(failure)} />
        ),
        ServerUnreachable: (failure) => (
          <ReceiveUnavailable notice={unavailableNotice(failure)} />
        ),
        LedgerUnreachable: (failure) => (
          <ReceiveUnavailable notice={unavailableNotice(failure)} />
        ),
        ServiceFailed: (failure) => (
          <ReceiveUnavailable notice={unavailableNotice(failure)} />
        ),
        SessionRequired: (failure) => (
          <ReceiveUnavailable notice={unavailableNotice(failure)} />
        ),
        RateLimited: (failure) => (
          <ReceiveUnavailable notice={unavailableNotice(failure)} />
        ),
        InvalidResponse: (failure) => (
          <ReceiveUnavailable notice={unavailableNotice(failure)} />
        ),
      })}
    </ReceiveFrame>
  );
}

function ReceiveUnavailable({ notice }: { notice: UnavailableNotice }) {
  const router = useRouter();

  return (
    <>
      <ScreenStatus title={m.deposit_unavailable_title()}>
        <ScreenNote>{notice.message}</ScreenNote>
      </ScreenStatus>
      {notice.actionable ? (
        <ScreenActions>
          <Button className="w-full" onClick={() => void router.invalidate()}>
            {m.common_retry()}
          </Button>
        </ScreenActions>
      ) : null}
    </>
  );
}
