import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PasskeyChallenge,
  WalletClient,
  WalletUnavailable,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Predicate from "effect/Predicate";

const freshForMillis = 4 * 60_000;

const staleCheckEveryMillis = 30_000;

export type HeldChallenge = Data.TaggedEnum<{
  Fetching: {};
  Ready: { readonly challenge: PasskeyChallenge; readonly issuedAt: number };
  Unreachable: { readonly failure: WalletUnavailable };
}>;

export const HeldChallenge = Data.taggedEnum<HeldChallenge>();

const expired = (held: HeldChallenge, now: number) =>
  Predicate.isTagged(held, "Ready") && now - held.issuedAt >= freshForMillis;

export function useSessionChallenge(
  client: Pick<WalletClient, "sessionChallenge">,
) {
  const [held, setHeld] = useState<HeldChallenge>(HeldChallenge.Fetching());
  const latest = useRef(held);
  const fetching = useRef(false);

  const hold = useCallback((next: HeldChallenge) => {
    latest.current = next;
    setHeld(next);
  }, []);

  const refresh = useCallback(async () => {
    if (fetching.current) return;

    fetching.current = true;
    hold(HeldChallenge.Fetching());

    const outcome = await client.sessionChallenge();

    fetching.current = false;
    hold(
      Predicate.isTagged(outcome, "ChallengeIssued")
        ? HeldChallenge.Ready({
            challenge: outcome.challenge,
            issuedAt: Date.now(),
          })
        : HeldChallenge.Unreachable({ failure: outcome }),
    );
  }, [client, hold]);

  useEffect(() => {
    void refresh();

    const refreshWhenVisible =
      (due: (held: HeldChallenge) => boolean) => () => {
        if (document.visibilityState === "visible" && due(latest.current))
          void refresh();
      };

    const refreshWhenStale = refreshWhenVisible(
      (held) =>
        Predicate.isTagged(held, "Unreachable") || expired(held, Date.now()),
    );

    const timer = window.setInterval(
      refreshWhenVisible((held) => expired(held, Date.now())),
      staleCheckEveryMillis,
    );

    document.addEventListener("visibilitychange", refreshWhenStale);
    window.addEventListener("pageshow", refreshWhenStale);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenStale);
      window.removeEventListener("pageshow", refreshWhenStale);
    };
  }, [refresh]);

  return { held, refresh };
}
