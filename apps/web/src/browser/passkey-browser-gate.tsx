import { useState, useSyncExternalStore } from "react";
import { Button } from "@workspace/ui/components/button";
import * as Match from "effect/Match";

import {
  Screen,
  ScreenActions,
  ScreenNote,
  ScreenStatus,
} from "@/components/screen";
import {
  type EmbeddedApp,
  androidDefaultBrowserLink,
  classifyBrowser,
} from "@/browser/support";
import { m } from "@/paraglide/messages";

const subscribeToNothing = () => () => {};

const readUserAgent = () => navigator.userAgent;

const readMaxTouchPoints = () => navigator.maxTouchPoints;

const unclassifiedOnServer = () => undefined;

export function PasskeyBrowserGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const userAgent = useSyncExternalStore(
    subscribeToNothing,
    readUserAgent,
    unclassifiedOnServer,
  );

  const maxTouchPoints = useSyncExternalStore(
    subscribeToNothing,
    readMaxTouchPoints,
    unclassifiedOnServer,
  );

  if (userAgent === undefined || maxTouchPoints === undefined) return null;

  return Match.valueTags(classifyBrowser(userAgent, maxTouchPoints), {
    Supported: () => children,
    OutdatedIos: () => <OutdatedIosScreen />,
    EmbeddedBrowser: ({ app, platform }) => (
      <EmbeddedBrowserScreen app={app} android={platform === "android"} />
    ),
  });
}

function OutdatedIosScreen() {
  return (
    <Screen>
      <ScreenStatus
        title={m.browser_outdated_ios_title()}
        data-testid="outdated-ios"
      >
        <ScreenNote>{m.browser_outdated_ios_note()}</ScreenNote>
      </ScreenStatus>
    </Screen>
  );
}

function EmbeddedBrowserScreen({
  app,
  android,
}: {
  app: EmbeddedApp;
  android: boolean;
}) {
  const [copied, setCopied] = useState<"idle" | "copied" | "unavailable">(
    "idle",
  );

  const destination = window.location.href;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(destination);
      setCopied("copied");
    } catch {
      setCopied("unavailable");
    }
  };

  return (
    <Screen>
      <main
        data-testid="embedded-browser"
        className="flex flex-1 flex-col gap-4 px-5 pt-16"
      >
        <div className="flex flex-col gap-2">
          <h1 className="font-display text-h1 text-balance">
            {m.browser_embedded_title()}
          </h1>
          <ScreenNote>{m.browser_embedded_reason({ app })}</ScreenNote>
          <ScreenNote>{m.browser_embedded_storage({ app })}</ScreenNote>
        </div>
        <section className="flex flex-col gap-2">
          <h2 className="text-label-lg">{m.browser_open_in_browser()}</h2>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-body text-muted-foreground">
            <li>{m.browser_step_menu({ app })}</li>
            <li>{m.browser_step_choose()}</li>
            <li>{m.browser_step_paste()}</li>
          </ol>
          {copied === "unavailable" ? (
            <>
              <p role="alert" className="text-caption text-destructive">
                {m.browser_copy_failed()}
              </p>
              <p
                data-testid="embedded-browser-link"
                className="rounded-lg bg-secondary p-3 text-caption break-all select-all"
              >
                {destination}
              </p>
            </>
          ) : null}
        </section>
      </main>
      <ScreenActions>
        {android ? (
          <Button
            className="w-full"
            nativeButton={false}
            render={
              <a
                href={androidDefaultBrowserLink(destination)}
                data-testid="open-in-browser"
              />
            }
          >
            {m.browser_open_in_browser()}
          </Button>
        ) : null}
        <Button
          className="w-full"
          variant={android ? "ghost" : "default"}
          onClick={copy}
          data-testid="copy-link"
        >
          {copied === "copied"
            ? m.browser_link_copied()
            : m.browser_copy_link()}
        </Button>
      </ScreenActions>
    </Screen>
  );
}
