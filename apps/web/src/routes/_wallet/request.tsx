import { XIcon } from "lucide-react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { Screen } from "@/components/screen";
import { TopNav } from "@/components/top-nav";
import { RequestForm } from "@/requests/request-form";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_wallet/request")({
  ssr: false,
  component: RequestMoney,
});

function RequestMoney() {
  return (
    <Screen>
      <TopNav
        title={m.payment_request_nav_title()}
        label={m.common_close()}
        icon={<XIcon absoluteStrokeWidth />}
        link={<Link to="/home" />}
      />
      <RequestForm />
    </Screen>
  );
}
