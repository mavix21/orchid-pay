import { useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from "@workspace/ui/components/item";
import type {
  OpenPaymentRequestsOutcome,
  PaymentRequestId,
  PaymentRequestOpen,
} from "@workspace/wallet";
import * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import { formattingLocale } from "@/locale/format";
import { amountLabel } from "@/send/money";
import { useWalletTask } from "@/send/use-wallet-task";
import { paymentRequestEffects } from "@/wallet/payment-requests";
import { m } from "@/paraglide/messages";

import { type RequestRefusal, requestRefusal } from "./request-refusal";
import { RequestShareModal, useRequestShare } from "./request-share";

const createdOn = (request: PaymentRequestOpen) =>
  DateTime.toDate(request.createdAt).toLocaleString(formattingLocale(), {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

export function OpenRequests({
  outcome,
}: {
  outcome: OpenPaymentRequestsOutcome;
}) {
  const unavailable = (refusal: RequestRefusal) => (
    <RequestsUnavailable message={requestRefusal(refusal)} />
  );

  return Match.valueTags(outcome, {
    OpenPaymentRequests: ({ requests }) =>
      requests.length === 0 ? null : <RequestList requests={requests} />,
    NotOpened: () => null,
    NoWallet: unavailable,
    UnsupportedDevice: unavailable,
    Offline: unavailable,
    ServerUnreachable: unavailable,
    LedgerUnreachable: unavailable,
    ServiceFailed: unavailable,
    SessionRequired: unavailable,
    RateLimited: unavailable,
    InvalidResponse: unavailable,
  });
}

function RequestList({
  requests,
}: {
  requests: ReadonlyArray<PaymentRequestOpen>;
}) {
  const router = useRouter();
  const task = useWalletTask();
  const sharing = useRequestShare();
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState(Option.none<string>());

  const settled = () =>
    void router.invalidate().finally(() => setCancelling(false));

  const refuse = (refusal: RequestRefusal) => {
    setCancelling(false);
    setProblem(Option.some(requestRefusal(refusal)));
  };

  const cancel = (id: PaymentRequestId) => {
    setCancelling(true);
    setProblem(Option.none());
    task.run(paymentRequestEffects.cancel(id), (answer) =>
      Match.valueTags(answer, {
        PaymentRequestCancelled: settled,
        PaymentRequestPaid: settled,
        PaymentRequestNotFound: settled,
        PaymentRequestBeingPaid: () => {
          setCancelling(false);
          setProblem(Option.some(m.payment_request_being_paid()));
        },
        NotOpened: refuse,
        NoWallet: refuse,
        UnsupportedDevice: refuse,
        DeviceFailure: refuse,
        Offline: refuse,
        ServerUnreachable: refuse,
        LedgerUnreachable: refuse,
        ServiceFailed: refuse,
        SessionRequired: refuse,
        RateLimited: refuse,
        InvalidResponse: refuse,
      }),
    );
  };

  return (
    <section
      aria-labelledby="open-requests-title"
      className="flex flex-col gap-3 px-5 pt-2 pb-4"
    >
      <h2 id="open-requests-title" className="text-label-lg">
        {m.payment_requests_open_title()}
      </h2>
      {Option.isSome(problem) ? (
        <p role="alert" className="text-body text-destructive">
          {problem.value}
        </p>
      ) : null}
      <div role="list" className="flex flex-col gap-3">
        {requests.map((request) => {
          const labelled = {
            amount: amountLabel(request.amount, request.asset),
            created: createdOn(request),
          };

          return (
            <Item
              key={request.id}
              variant="outline"
              role="listitem"
              data-testid="open-request-row"
              data-request={request.id}
            >
              <ItemContent>
                <ItemTitle className="whitespace-nowrap">
                  {labelled.amount}
                </ItemTitle>
                {request.note === undefined ? null : (
                  <ItemDescription>{request.note}</ItemDescription>
                )}
                <ItemDescription>{labelled.created}</ItemDescription>
              </ItemContent>
              <ItemFooter className="justify-end">
                <Button
                  size="sm"
                  disabled={cancelling}
                  onClick={() => sharing.open(request)}
                  aria-label={m.payment_request_share_again_label(labelled)}
                  data-testid="reshare-request"
                >
                  {m.payment_request_share_again()}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={cancelling}
                  onClick={() => cancel(request.id)}
                  aria-label={m.payment_request_cancel_label(labelled)}
                  data-testid="cancel-request"
                >
                  {m.payment_request_cancel()}
                </Button>
              </ItemFooter>
            </Item>
          );
        })}
      </div>
      <RequestShareModal sharing={sharing} />
    </section>
  );
}

function RequestsUnavailable({ message }: { message: string }) {
  const router = useRouter();

  return (
    <section className="flex flex-col gap-3 px-5 pt-2 pb-4">
      <h2 className="text-label-lg">
        {m.payment_requests_unavailable_title()}
      </h2>
      <p role="alert" className="text-body text-muted-foreground">
        {message}
      </p>
      <Button variant="secondary" onClick={() => void router.invalidate()}>
        {m.common_retry()}
      </Button>
    </section>
  );
}
