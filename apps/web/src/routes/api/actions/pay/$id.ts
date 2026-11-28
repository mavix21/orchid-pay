import { createFileRoute } from "@tanstack/react-router";
import {
  actionHeaders,
  describePaymentRequest,
  draftPaymentRequestTransaction,
} from "@/requests/payment-request-action.server";

export const Route = createFileRoute("/api/actions/pay/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => describePaymentRequest(request, params.id),
      POST: ({ request, params }) =>
        draftPaymentRequestTransaction(request, params.id),
      OPTIONS: () => new Response(null, { headers: actionHeaders }),
    },
  },
});
