import { CheckIcon } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@workspace/ui/components/button";

import {
  type HumanCheckStatus,
  expireHumanCheck,
  failHumanCheck,
  humanCheckStatus,
  interactHumanCheck,
  mountHumanCheck,
  offerHumanCheck,
  onHumanCheckTaken,
  watchHumanCheck,
} from "@/wallet/human-check";
import { humanCheckSiteKeyFn } from "@/wallet/human-check.functions";
import { m } from "@/paraglide/messages";
import { type Locale, getLocale } from "@/paraglide/runtime";

interface TurnstileOptions {
  readonly sitekey: string;
  readonly appearance: "interaction-only";
  readonly language: Locale;
  readonly callback: (token: string) => void;
  readonly "expired-callback": () => void;
  readonly "timeout-callback": () => void;
  readonly "error-callback": () => void;
  readonly "before-interactive-callback": () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    readonly turnstile?: TurnstileApi;
  }
}

const turnstileScript =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let loading: Promise<TurnstileApi> | undefined;

const loadTurnstile = () => {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");

    script.src = turnstileScript;
    script.async = true;
    script.addEventListener("load", () => {
      if (window.turnstile) {
        resolve(window.turnstile);

        return;
      }

      loading = undefined;
      script.remove();
      reject(new Error("Turnstile did not initialize"));
    });
    script.addEventListener("error", () => {
      loading = undefined;
      script.remove();
      reject(new Error("Turnstile did not load"));
    });
    document.head.appendChild(script);
  });

  return loading;
};

const waitingOnServer = (): HumanCheckStatus => "waiting";

export const useHumanCheckStatus = () =>
  useSyncExternalStore(watchHumanCheck, humanCheckStatus, waitingOnServer);

export function HumanCheckWidget({ quiet = false }: { quiet?: boolean }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const status = useHumanCheckStatus();

  useEffect(() => {
    if (host === null) return;

    let active = true;
    let widgetId: string | undefined;
    let release = () => {};
    const unmount = mountHumanCheck();

    void Promise.all([humanCheckSiteKeyFn(), loadTurnstile()])
      .then(([sitekey, turnstile]) => {
        if (!active) return;

        const rendered = turnstile.render(host, {
          sitekey,
          appearance: "interaction-only",
          language: getLocale(),
          callback: offerHumanCheck,
          "expired-callback": expireHumanCheck,
          "timeout-callback": expireHumanCheck,
          "error-callback": failHumanCheck,
          "before-interactive-callback": interactHumanCheck,
        });

        if (rendered === undefined) {
          failHumanCheck();

          return;
        }

        widgetId = rendered;

        release = onHumanCheckTaken(() => {
          if (widgetId !== undefined) turnstile.reset(widgetId);
        });
      })
      .catch(() => {
        if (active) failHumanCheck();
      });

    return () => {
      active = false;
      release();
      unmount();

      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
    };
  }, [host]);

  const retry = (
    <div
      role="alert"
      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background text-center"
    >
      <p className="text-label text-destructive">{m.human_check_failed()}</p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setAttempt((current) => current + 1)}
      >
        {m.common_retry()}
      </Button>
    </div>
  );

  if (quiet)
    return (
      <div>
        <div
          key={attempt}
          ref={setHost}
          aria-hidden={status !== "interactive"}
          className={
            status === "interactive"
              ? "flex justify-center px-5 pb-safe"
              : "pointer-events-none h-0 overflow-hidden opacity-0"
          }
        />
        {status === "unavailable" ? (
          <div className="px-5 pb-safe">
            <div className="relative h-18">{retry}</div>
          </div>
        ) : null}
      </div>
    );

  return (
    <div className="relative flex h-18 w-full shrink-0 items-center justify-center">
      <div
        key={attempt}
        ref={setHost}
        aria-hidden={status !== "interactive"}
        className={
          status === "interactive" ? undefined : "pointer-events-none opacity-0"
        }
      />
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 flex justify-center"
      >
        {status === "waiting" ? (
          <p className="text-label text-muted-foreground motion-safe:animate-pulse">
            {m.human_check_verifying()}
          </p>
        ) : null}
        {status === "ready" ? (
          <p className="flex items-center gap-1.5 text-label text-muted-foreground">
            <CheckIcon aria-hidden="true" className="size-4 text-primary" />
            {m.human_check_verified()}
          </p>
        ) : null}
      </div>
      {status === "unavailable" ? retry : null}
    </div>
  );
}
