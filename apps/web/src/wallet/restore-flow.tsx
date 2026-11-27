import { ChevronLeftIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import type {
  BackupLocated,
  RestoreOutcome,
  WalletClient,
} from "@workspace/wallet";
import * as Match from "effect/Match";
import * as Predicate from "effect/Predicate";

import { Screen, ScreenActions } from "@/components/screen";
import { TopNav, type TopNavAction } from "@/components/top-nav";
import { sessionLapse } from "@/wallet/session-lapse";
import { retryable, unavailableMessage } from "@/wallet/unavailable";
import { m } from "@/paraglide/messages";

type Refusal = Exclude<RestoreOutcome, { _tag: "Restored" | "BackupLocated" }>;

const refusal = (outcome: Refusal) =>
  Match.valueTags(outcome, {
    BackupUnsupported: () => m.restore_backup_unsupported(),
    PasskeyCancelled: () => m.restore_passkey_cancelled(),
    PasskeyFailed: () => m.passkey_failed(),
    ChallengeRefused: () => m.restore_challenge_refused(),
    NoBackup: () => m.restore_no_backup(),
    AssertionRefused: () => m.restore_assertion_refused(),
    BackupMismatch: () => m.restore_backup_mismatch(),
    RestoreUnverified: () => m.restore_unverified(),
    UnsupportedDevice: () => m.device_cannot_store_key(),
    CorruptDeviceWallet: () => m.restore_corrupt_device(),
    Offline: unavailableMessage,
    ServerUnreachable: unavailableMessage,
    LedgerUnreachable: unavailableMessage,
    ServiceFailed: unavailableMessage,
    SessionRequired: unavailableMessage,
    RateLimited: unavailableMessage,
    InvalidResponse: unavailableMessage,
  });

const stageCopy = (progress: BackupLocated | undefined) =>
  Match.value(progress).pipe(
    Match.tag("BackupLocated", ({ profile }) => ({
      description: m.restore_located({ username: profile.username }),
      action: m.restore_save_here(),
    })),
    Match.orElse(() => ({
      description: m.restore_explanation(),
      action: m.restore_action(),
    })),
  );

export function RestoreFlow({
  walletClient,
  back,
  onRestored,
}: {
  walletClient: WalletClient;
  back: TopNavAction;
  onRestored: () => void;
}) {
  const [restoring, setRestoring] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [stopped, setStopped] = useState(false);
  const [progress, setProgress] = useState<BackupLocated>();
  const copy = stageCopy(progress);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
      void walletClient.cancelRestore();
    };
  }, [walletClient]);

  const restore = async () => {
    setRestoring(true);
    setProblem(undefined);

    const outcome = await walletClient.restore();

    if (Predicate.isTagged(outcome, "Restored")) sessionLapse.clear();

    if (!mounted.current) return;

    Match.value(outcome).pipe(
      Match.tag("Restored", () => onRestored()),
      Match.tag("BackupLocated", (next) => {
        setProgress(next);
        setRestoring(false);
      }),
      Match.orElse((refused) => {
        if (!Predicate.isTagged(refused, "PasskeyCancelled"))
          setProgress(undefined);

        setProblem(refusal(refused));
        setStopped(!retryable(refused));
        setRestoring(false);
      }),
    );
  };

  return (
    <Screen>
      <TopNav
        title={m.restore_nav_title()}
        label={m.common_back()}
        icon={<ChevronLeftIcon />}
        {...back}
      />
      <main className="flex flex-1 flex-col gap-2 px-5 pt-2">
        <h1 className="font-display text-h1">{m.restore_title()}</h1>
        <p className="text-body text-muted-foreground">{copy.description}</p>
        {problem ? (
          <p role="alert" className="text-body text-destructive">
            {problem}
          </p>
        ) : null}
      </main>
      <ScreenActions>
        <Button
          className="w-full"
          disabled={restoring || stopped}
          onClick={restore}
          data-testid="restore-submit"
        >
          {restoring ? m.restore_restoring() : copy.action}
        </Button>
      </ScreenActions>
    </Screen>
  );
}
