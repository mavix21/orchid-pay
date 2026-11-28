import { LockIcon } from "lucide-react";
import {
  ClientOnly,
  Link,
  createFileRoute,
  redirect,
} from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { lazy, Suspense, useCallback, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitch } from "@/locale/language-switch";
import { m } from "@/paraglide/messages";
import { useHomeForSavedWallet } from "@/wallet/use-home-for-saved-wallet";
import { deviceHoldsWallet } from "@/wallet/wallet-cookie";
import { type CashOut, cashOutAt } from "@/welcome/cash-out-methods";
import { RotatingCashOutMethod } from "@/welcome/rotating-cash-out-method";

const PaymentLinkGlobe = lazy(() =>
  import("@/welcome/payment-link-globe").then(({ PaymentLinkGlobe }) => ({
    default: PaymentLinkGlobe,
  })),
);

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    if (deviceHoldsWallet()) throw redirect({ to: "/home" });
  },
  component: Welcome,
});

function Welcome() {
  useHomeForSavedWallet();

  const [cashedOut, setCashedOut] = useState({
    turn: 0,
    method: cashOutAt(0).method,
  });

  const onCashOut = useCallback(
    (turn: number, cashOut: CashOut) =>
      setCashedOut({ turn, method: cashOut.method }),
    [],
  );

  return (
    <div className="flex min-h-dvh flex-col overflow-x-hidden bg-background pt-safe text-foreground">
      <header className="flex items-center justify-between px-5 pt-2 md:px-10 md:pt-8">
        <BrandLogo />
        <LanguageSwitch />
      </header>
      <main className="mx-auto grid w-full max-w-md flex-1 gap-2 px-5 pb-safe max-md:welcome-layout md:pb-6 md:max-w-6xl md:grid-cols-2 md:content-center md:items-center md:gap-x-10 md:gap-y-12 md:px-10">
        <div className="flex flex-col gap-2 pt-2 md:gap-4 md:pt-0">
          <h1 className="font-display text-display max-md:welcome-headline md:text-8xl">
            <span className="block md:welcome-rise">
              {m.welcome_headline_send()}
            </span>
            <span className="block md:welcome-rise md:welcome-delay-1">
              {m.welcome_headline_no_wallet()}
            </span>
          </h1>
          <p className="flex flex-col gap-1 font-display text-h1 max-md:text-2xl md:welcome-rise md:welcome-delay-2 md:gap-2 md:text-5xl">
            <span>{m.welcome_cash_out_in()}</span>
            <span>
              <RotatingCashOutMethod
                turn={cashedOut.turn}
                method={cashedOut.method}
                previousMethod={
                  cashedOut.turn > 0
                    ? cashOutAt(cashedOut.turn - 1).method
                    : undefined
                }
              />
            </span>
          </p>
        </div>
        <div className="welcome-rise welcome-delay-3 grid place-items-center max-md:welcome-globe-space md:row-span-2">
          <div className="aspect-square w-full max-md:welcome-globe-size">
            <ClientOnly>
              <Suspense fallback={null}>
                <PaymentLinkGlobe onCashOut={onCashOut} />
              </Suspense>
            </ClientOnly>
          </div>
        </div>
        <div className="flex flex-col items-center gap-2 md:welcome-rise md:welcome-delay-5 md:max-w-sm">
          <Button
            className="w-full"
            nativeButton={false}
            render={<Link to="/create-account" data-testid="start-create" />}
          >
            {m.welcome_create_account()}
          </Button>
          <Button
            className="w-full"
            variant="ghost"
            nativeButton={false}
            render={<Link to="/restore" data-testid="start-restore" />}
          >
            {m.welcome_have_account()}
          </Button>
          <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <LockIcon className="size-3.5" />
            {m.welcome_key_stays()}
          </p>
        </div>
      </main>
    </div>
  );
}
