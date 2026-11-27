import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { WalletClient } from "@workspace/wallet";

import appCss from "@workspace/ui/globals.css?url";
import { Screen, ScreenNote, ScreenStatus } from "@/components/screen";
import { ThemeProvider } from "@/components/theme-provider";
import { getLocale } from "@/paraglide/runtime";
import { m } from "@/paraglide/messages";

export const Route = createRootRouteWithContext<{
  walletClient: WalletClient;
}>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      {
        name: "referrer",
        content: "no-referrer",
      },
      {
        title: "Orchid",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: () => (
    <Screen>
      <ScreenStatus title="404">
        <ScreenNote>{m.not_found_note()}</ScreenNote>
      </ScreenStatus>
    </Screen>
  ),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang={getLocale()} suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider defaultTheme="system" storageKey="theme">
          {children}
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}
