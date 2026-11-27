import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { PasskeyBrowserGate } from "@/browser/passkey-browser-gate";
import { RestoreFlow } from "@/wallet/restore-flow";
import { useHomeForSavedWallet } from "@/wallet/use-home-for-saved-wallet";

export const Route = createFileRoute("/restore")({
  component: () => (
    <PasskeyBrowserGate>
      <RestoreAccount />
    </PasskeyBrowserGate>
  ),
});

function RestoreAccount() {
  const navigate = useNavigate();
  const { walletClient } = Route.useRouteContext();

  useHomeForSavedWallet();

  return (
    <RestoreFlow
      walletClient={walletClient}
      back={{ link: <Link to="/" /> }}
      onRestored={() => void navigate({ to: "/home", replace: true })}
    />
  );
}
