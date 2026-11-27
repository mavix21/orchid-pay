import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { SessionGate } from "@/wallet/session-gate";
import { deviceHoldsWallet } from "@/wallet/wallet-cookie";

export const Route = createFileRoute("/_wallet")({
  beforeLoad: () => {
    if (!deviceHoldsWallet()) throw redirect({ to: "/" });
  },
  component: WalletLayout,
});

function WalletLayout() {
  return (
    <SessionGate>
      <Outlet />
    </SessionGate>
  );
}
