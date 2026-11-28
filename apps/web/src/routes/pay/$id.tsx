import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  PaymentRequestId,
  PaymentRequestNotFound,
  type PaymentRequestOpen,
  type PaymentRequestPaid,
  type PaymentRequestCancelled,
  PaymentRequestStep,
  WalletUnavailable,
} from "@workspace/wallet";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { PasskeyBrowserGate } from "@/browser/passkey-browser-gate";
import { BrandLogo } from "@/components/brand-logo";
import { explorerTransactionUrl } from "@/components/explorer";
import { FlowerAvatar } from "@/components/flower-avatar";
import {
  Screen,
  ScreenActions,
  ScreenNote,
  ScreenStatus,
} from "@/components/screen";
import { linkPreviewMeta } from "@/links/link-preview";
import { ExternalPay } from "@/requests/external-pay";
import { PayRequest } from "@/requests/pay-request";
import { paymentRequestPort } from "@/requests/payment-requests.functions";
import { amountLabel } from "@/send/money";
import { retryable, unavailableMessage } from "@/wallet/unavailable";
import { useSavedUsername } from "@/wallet/use-saved-username";
import { m } from "@/paraglide/messages";

const PaymentRequestAnswer = Schema.Union([
  PaymentRequestStep,
  WalletUnavailable,
]);

type PaymentRequestAnswer = typeof PaymentRequestAnswer.Type;

type FoundRequest =
  | PaymentRequestOpen
  | PaymentRequestPaid
  | PaymentRequestCancelled;

const decodeAnswer = Schema.decodeSync(PaymentRequestAnswer);

const readRequest = (idText: string) =>
  Option.match(Schema.decodeOption(PaymentRequestId)(idText), {
    onNone: () =>
      Effect.succeed<PaymentRequestAnswer>(new PaymentRequestNotFound()),
    onSome: (id) =>
      paymentRequestPort
        .read(id)
        .pipe(Effect.catch((failure) => Effect.succeed(failure))),
  }).pipe(
    Effect.flatMap(Schema.encodeEffect(PaymentRequestAnswer)),
    Effect.orDie,
  );

const named = ({ requester, amount, asset }: FoundRequest) => ({
  username: requester,
  amount: amountLabel(amount, asset),
});

const unavailablePreview = () => ({
  title: m.payment_request_message_title(),
  description: m.payment_request_preview_open_description(),
});

const previewOf = (answer: PaymentRequestAnswer) =>
  Match.valueTags(answer, {
    PaymentRequestOpen: (request) => ({
      title: m.payment_request_preview_open_title(named(request)),
      description: m.payment_request_preview_open_description(),
    }),
    PaymentRequestPaid: (request) => ({
      title: m.payment_request_preview_paid_title(named(request)),
      description: m.payment_request_preview_paid_description(),
    }),
    PaymentRequestCancelled: (request) => ({
      title: m.payment_request_preview_cancelled_title(named(request)),
      description: m.payment_request_preview_cancelled_description(),
    }),
    PaymentRequestNotFound: () => ({
      title: m.payment_request_missing_title(),
      description: m.payment_request_missing_note(),
    }),
    Offline: unavailablePreview,
    ServerUnreachable: unavailablePreview,
    LedgerUnreachable: unavailablePreview,
    ServiceFailed: unavailablePreview,
    SessionRequired: unavailablePreview,
    RateLimited: unavailablePreview,
    InvalidResponse: unavailablePreview,
  });

export const Route = createFileRoute("/pay/$id")({
  ssr: "data-only",
  loader: ({ params }) => Effect.runPromise(readRequest(params.id)),
  head: ({ loaderData, params }) => ({
    meta: linkPreviewMeta({
      ...(loaderData === undefined
        ? unavailablePreview()
        : previewOf(decodeAnswer(loaderData))),
      path: `/pay/${encodeURIComponent(params.id)}`,
      image: "/og-payment-request.png",
    }),
  }),
  component: PaymentRequestPage,
});

function PaymentRequestPage() {
  const answer = decodeAnswer(Route.useLoaderData());
  const [paying, setPaying] = useState(false);
  const [paidHere, setPaidHere] = useState(Option.none<PaymentRequestId>());

  if (paying && Predicate.isTagged(answer, "PaymentRequestOpen"))
    return (
      <PasskeyBrowserGate>
        <PayRequest
          request={answer}
          onBack={() => setPaying(false)}
          onPaid={() => setPaidHere(Option.some(answer.id))}
        />
      </PasskeyBrowserGate>
    );

  const found = (
    request: FoundRequest,
    status: React.ReactNode,
    heading = m.payment_request_asks({ username: request.requester }),
  ) => <RequestDetails request={request} heading={heading} status={status} />;

  const unavailable = (failure: WalletUnavailable) => (
    <RequestUnavailable failure={failure} />
  );

  return (
    <Screen>
      <header className="flex h-14 items-center justify-center md:hidden">
        <BrandLogo />
      </header>
      {Match.valueTags(answer, {
        PaymentRequestOpen: (request) => (
          <>
            {found(
              request,
              <Badge variant="warning">
                {m.payment_request_status_open()}
              </Badge>,
            )}
            <ExternalPay request={request} />
            <PayAction request={request} onPay={() => setPaying(true)} />
          </>
        ),
        PaymentRequestPaid: (request) => (
          <>
            {found(
              request,
              <Badge variant="success">
                {m.payment_request_status_paid()}
              </Badge>,
              Option.contains(paidHere, request.id)
                ? m.pay_request_paid_title({ username: request.requester })
                : undefined,
            )}
            <PaidNextStep
              request={request}
              paidHere={Option.contains(paidHere, request.id)}
            />
          </>
        ),
        PaymentRequestCancelled: (request) =>
          found(
            request,
            <Badge variant="neutral">
              {m.payment_request_status_cancelled()}
            </Badge>,
          ),
        PaymentRequestNotFound: () => (
          <ScreenStatus
            title={m.payment_request_missing_title()}
            data-testid="payment-request-missing"
          >
            <ScreenNote>{m.payment_request_missing_note()}</ScreenNote>
          </ScreenStatus>
        ),
        Offline: unavailable,
        ServerUnreachable: unavailable,
        LedgerUnreachable: unavailable,
        ServiceFailed: unavailable,
        SessionRequired: unavailable,
        RateLimited: unavailable,
        InvalidResponse: unavailable,
      })}
    </Screen>
  );
}

function PayAction({
  request,
  onPay,
}: {
  request: PaymentRequestOpen;
  onPay: () => void;
}) {
  const saved = useSavedUsername();

  if (!saved.read || Option.contains(saved.username, request.requester))
    return null;

  return (
    <ScreenActions>
      <Button className="w-full" data-testid="pay-request" onClick={onPay}>
        {m.pay_request_action()}
      </Button>
    </ScreenActions>
  );
}

function PaidNextStep({
  request,
  paidHere,
}: {
  request: PaymentRequestPaid;
  paidHere: boolean;
}) {
  const saved = useSavedUsername();

  const home = (
    <Button
      className="w-full"
      nativeButton={false}
      render={<Link to="/home" data-testid="paid-home" />}
    >
      {m.common_back_home()}
    </Button>
  );

  if (paidHere)
    return (
      <ScreenActions>
        {home}
        <Button
          className="w-full"
          variant="secondary"
          nativeButton={false}
          render={<Link to="/activity" data-testid="paid-activity" />}
        >
          {m.pay_request_see_activity()}
        </Button>
      </ScreenActions>
    );

  if (!saved.read) return null;

  if (Option.contains(saved.username, request.requester))
    return <ScreenActions>{home}</ScreenActions>;

  return (
    <ScreenActions>
      {Option.isSome(saved.username) ? (
        home
      ) : (
        <>
          <p className="pb-2 text-center text-body text-pretty text-muted-foreground">
            {m.pay_request_invite_note()}
          </p>
          <Button
            className="w-full"
            nativeButton={false}
            render={
              <Link to="/create-account" data-testid="paid-create-account" />
            }
          >
            {m.pay_request_create_account()}
          </Button>
        </>
      )}
      {request.externalPaymentHash === undefined ? null : (
        <Button
          className="w-full"
          variant="ghost"
          nativeButton={false}
          render={
            <a
              href={explorerTransactionUrl(request.externalPaymentHash)}
              target="_blank"
              rel="noreferrer"
              data-testid="paid-transaction"
            />
          }
        >
          <ExternalLinkIcon />
          {m.explorer_view()}
        </Button>
      )}
    </ScreenActions>
  );
}

function RequestDetails({
  request,
  heading,
  status,
}: {
  request: FoundRequest;
  heading: string;
  status: React.ReactNode;
}) {
  const { username, amount } = named(request);

  return (
    <main
      className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-8 text-center"
      data-testid="payment-request"
      data-state={request._tag}
      data-requester={username}
    >
      <div data-testid="payment-request-avatar">
        <FlowerAvatar username={username} size="xl" />
      </div>
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-body-lg text-muted-foreground">{heading}</h1>
        <p
          className="font-display text-display"
          data-testid="payment-request-amount"
          data-amount={amount}
        >
          {amount}
        </p>
      </div>
      {request.note === undefined ? null : (
        <p
          className="text-body-lg text-pretty wrap-anywhere"
          data-testid="payment-request-note"
          data-note={request.note}
        >
          {request.note}
        </p>
      )}
      {status}
    </main>
  );
}

function RequestUnavailable({ failure }: { failure: WalletUnavailable }) {
  const router = useRouter();

  return (
    <>
      <ScreenStatus title={m.payment_request_unavailable_title()}>
        <ScreenNote>{unavailableMessage(failure)}</ScreenNote>
      </ScreenStatus>
      {retryable(failure) ? (
        <ScreenActions>
          <Button className="w-full" onClick={() => void router.invalidate()}>
            {m.common_retry()}
          </Button>
        </ScreenActions>
      ) : null}
    </>
  );
}
