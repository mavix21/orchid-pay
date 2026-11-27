import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  type ActivityOutcome,
  Amount,
  type BackUpOutcome,
  type Holding,
  type SavedBackup,
  type SavedOutcome,
  type UnclaimedFunds,
  type WalletUnavailable,
  baseAsset,
} from "@workspace/wallet";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import { RecentActivity } from "@/activity/recent-activity";
import { BalanceHeader } from "@/components/balance-header";
import { HomeSkeleton } from "@/components/home-skeleton";
import { Screen, ScreenNote, ScreenStatus } from "@/components/screen";
import { arrivalOf } from "@/wallet/arrival";
import { OpeningFlow } from "@/wallet/opening-flow";
import { paymentRequestEffects } from "@/wallet/payment-requests";
import { shownOverview } from "@/wallet/shown-overview";
import {
  retryable,
  unavailableMessage,
  unavailableNotice,
} from "@/wallet/unavailable";
import { WaitingPayment } from "@/wallet/waiting-payment";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_wallet/_app/home")({
  ssr: false,
  pendingMs: 0,
  pendingComponent: HomeSkeleton,
  loader: async ({ context }) => {
    const [overview, saved, activity] = await Promise.all([
      context.walletClient.overview(),
      context.walletClient.saved(),
      Effect.runPromise(paymentRequestEffects.activity()),
    ]);

    return {
      overview: shownOverview(overview),
      arrival: arrivalOf(overview),
      backup: savedBackup(saved),
      activity,
    };
  },
  component: HomeScreen,
});

const savedBackup = (saved: SavedOutcome): Option.Option<SavedBackup> =>
  Match.valueTags(saved, {
    SavedWallet: ({ backup }) => Option.some(backup),
    NoWallet: () => Option.some<SavedBackup>("none"),
    UnsupportedDevice: () => Option.some<SavedBackup>("none"),
    Offline: () => Option.none(),
    ServerUnreachable: () => Option.none(),
    LedgerUnreachable: () => Option.none(),
    ServiceFailed: () => Option.none(),
    SessionRequired: () => Option.none(),
    RateLimited: () => Option.none(),
    InvalidResponse: () => Option.none(),
  });

const backUpRefusal = (
  outcome: Exclude<BackUpOutcome, { _tag: "BackupStored" }>,
) =>
  Match.valueTags(outcome, {
    BackupUnsupported: () => m.home_backup_unsupported(),
    PasskeyCancelled: () => m.home_backup_passkey_cancelled(),
    PasskeyFailed: () => m.home_backup_passkey_failed(),
    ChallengeRefused: () => m.home_backup_challenge_refused(),
    RegistrationRefused: () => m.home_backup_refused(),
    NoWallet: () => m.device_cannot_read_key(),
    UnsupportedDevice: () => m.device_cannot_read_key(),
    Offline: unavailableMessage,
    ServerUnreachable: unavailableMessage,
    LedgerUnreachable: unavailableMessage,
    ServiceFailed: unavailableMessage,
    SessionRequired: unavailableMessage,
    RateLimited: unavailableMessage,
    InvalidResponse: unavailableMessage,
  });

function HomeScreen() {
  const { overview, arrival, backup, activity } = Route.useLoaderData();

  return Match.valueTags(overview, {
    Holding: (holding) => (
      <Home
        holding={holding}
        arrival={arrival}
        backup={backup}
        activity={activity}
      />
    ),
    NeedsReopening: ({ profile }) => <Reopening username={profile.username} />,
    InvalidAddress: () => <Problem message={m.common_stored_key_invalid()} />,
    UnsupportedDevice: () => <Problem message={m.device_cannot_read_key()} />,
    Offline: (failure) => <Unavailable failure={failure} />,
    ServerUnreachable: (failure) => <Unavailable failure={failure} />,
    LedgerUnreachable: (failure) => <Unavailable failure={failure} />,
    ServiceFailed: (failure) => <Unavailable failure={failure} />,
    SessionRequired: (failure) => <Unavailable failure={failure} />,
    RateLimited: (failure) => <Unavailable failure={failure} />,
    InvalidResponse: (failure) => <Unavailable failure={failure} />,
  });
}

function Home({
  holding,
  arrival,
  backup,
  activity,
}: {
  holding: Holding;
  arrival: Option.Option<UnclaimedFunds>;
  backup: Option.Option<SavedBackup>;
  activity: ActivityOutcome;
}) {
  const router = useRouter();

  const dollars =
    holding.balances.find((balance) => balance.asset.id === baseAsset.id)
      ?.amount ?? Amount.make(0n);

  return (
    <Screen>
      <main className="flex flex-1 flex-col gap-10 px-5 pt-2 pb-30 md:pb-16">
        <BalanceHeader username={holding.profile.username} dollars={dollars} />
        {Option.isSome(arrival) ? (
          <WaitingPayment
            key={arrival.value.id}
            payment={arrival.value}
            onReceived={() => router.invalidate()}
          />
        ) : null}
        {Option.isSome(backup) && backup.value !== "stored" ? (
          <BackupNotice />
        ) : null}
        <RecentActivity activity={activity} />
      </main>
    </Screen>
  );
}

function BackupNotice() {
  const router = useRouter();
  const { walletClient } = Route.useRouteContext();
  const [backingUp, setBackingUp] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [stopped, setStopped] = useState(false);

  const backUp = async () => {
    setBackingUp(true);
    setProblem(undefined);

    const outcome = await walletClient.backUp();

    await Match.value(outcome).pipe(
      Match.tag("BackupStored", () => router.invalidate()),
      Match.orElse((refused) => {
        setProblem(backUpRefusal(refused));
        setStopped(!retryable(refused));
      }),
    );

    setBackingUp(false);
  };

  return (
    <section
      aria-labelledby="backup-title"
      className="flex flex-col gap-3 rounded-lg bg-muted p-4"
    >
      <h2 id="backup-title" className="text-label-lg">
        {m.home_backup_title()}
      </h2>
      <p className="text-body text-muted-foreground">{m.home_backup_note()}</p>
      {problem ? (
        <p role="alert" className="text-body text-destructive">
          {problem}
        </p>
      ) : null}
      <Button
        className="w-full"
        disabled={backingUp || stopped}
        onClick={backUp}
      >
        {backingUp ? m.home_backing_up() : m.home_backup_action()}
      </Button>
    </section>
  );
}

function Reopening({ username }: { username: string }) {
  const router = useRouter();

  return (
    <Screen>
      <div className="flex flex-1 flex-col pb-30 md:pb-16">
        <OpeningFlow username={username} onOpened={() => router.invalidate()} />
      </div>
    </Screen>
  );
}

function Unavailable({ failure }: { failure: WalletUnavailable }) {
  const notice = unavailableNotice(failure);

  return notice.actionable ? (
    <Problem message={notice.message} />
  ) : (
    <Screen>
      <ScreenStatus title={m.common_account_load_failed()}>
        <ScreenNote>{notice.message}</ScreenNote>
      </ScreenStatus>
    </Screen>
  );
}

function Problem({ message }: { message: string }) {
  const router = useRouter();

  return (
    <Notice
      title={m.common_account_load_failed()}
      message={message}
      action={m.common_retry()}
      busy={false}
      onAction={() => router.invalidate()}
    />
  );
}

function Notice({
  title,
  message,
  action,
  busy,
  onAction,
}: {
  title: string;
  message: string;
  action: string;
  busy: boolean;
  onAction: () => void;
}) {
  return (
    <Screen>
      <ScreenStatus title={title}>
        <ScreenNote>{message}</ScreenNote>
        <Button className="mt-4 w-full" disabled={busy} onClick={onAction}>
          {action}
        </Button>
      </ScreenStatus>
    </Screen>
  );
}
