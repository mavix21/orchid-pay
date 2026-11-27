import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";

import { PasskeyBrowserGate } from "@/browser/passkey-browser-gate";
import { EnrollmentFlow } from "@/wallet/enrollment-flow";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/create-account")({
  component: () => (
    <PasskeyBrowserGate>
      <CreateAccount />
    </PasskeyBrowserGate>
  ),
});

function CreateAccount() {
  const { walletClient } = Route.useRouteContext();
  const navigate = useNavigate();

  const goHome = () => {
    void navigate({ to: "/home", replace: true });
  };

  return (
    <EnrollmentFlow
      title={m.enrollment_title()}
      back={(disabled) => ({ link: <Link to="/" disabled={disabled} /> })}
      walletClient={walletClient}
      onEnrolled={goHome}
      onOpened={goHome}
    />
  );
}
