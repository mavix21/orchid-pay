import { createFileRoute } from "@tanstack/react-router";
import { actionHeaders } from "@/requests/payment-request-action.server";

export const Route = createFileRoute("/actions.json")({
  server: {
    handlers: {
      GET: () =>
        Response.json(
          {
            rules: [{ pathPattern: "/pay/*", apiPath: "/api/actions/pay/*" }],
          },
          { headers: actionHeaders },
        ),
      OPTIONS: () => new Response(null, { headers: actionHeaders }),
    },
  },
});
