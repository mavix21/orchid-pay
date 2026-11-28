import {
  AccountAddress,
  type ExternalPaymentStep,
  PaymentRequestId,
  type PaymentRequestOpen,
  type PaymentRequestStep,
  type ServerFailure,
} from "@workspace/wallet";
import {
  type Principal,
  RequestPayments,
  blockchainId,
} from "@workspace/wallet/server";
import type * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { runPublicRequestPayments } from "@/server/wallet.server";
import { amountLabel } from "@/send/money";
import { unavailableMessage } from "@/wallet/unavailable";
import { m } from "@/paraglide/messages";

export const actionHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids",
  "Access-Control-Expose-Headers": "X-Action-Version, X-Blockchain-Ids",
  "X-Action-Version": "2.4",
  "X-Blockchain-Ids": blockchainId,
};

interface ActionError {
  readonly message: string;
}

interface ActionDescription {
  readonly type: "action";
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly label: string;
  readonly disabled?: boolean;
}

interface ActionTransaction {
  readonly type: "transaction";
  readonly transaction: string;
  readonly message: string;
}

const answer = (
  status: number,
  body: ActionError | ActionDescription | ActionTransaction,
) => Response.json(body, { status, headers: actionHeaders });

const refused = (status: number, message: string) =>
  answer(status, { message });

const named = ({
  requester,
  amount,
  asset,
}: Pick<PaymentRequestOpen, "requester" | "amount" | "asset">) => ({
  username: requester,
  amount: amountLabel(amount, asset),
});

const failed = (failure: ServerFailure) =>
  refused(
    Match.valueTags(failure, {
      RateLimited: () => 429,
      LedgerUnreachable: () => 503,
      ServiceFailed: () => 500,
      SessionRequired: () => 500,
    }),
    unavailableMessage(failure),
  );

const outcomeOf = async <A, E>(
  request: Request,
  answered: (step: A) => Response,
  program: Effect.Effect<A, E, RequestPayments | Principal>,
) =>
  Result.match(
    await runPublicRequestPayments(
      Option.fromNullishOr(request.headers.get("cf-connecting-ip")),
      program,
    ),
    { onFailure: failed, onSuccess: answered },
  );

const missing = () => refused(404, m.payment_request_missing_title());

const actionOf = (icon: string) => (step: PaymentRequestStep) =>
  Match.valueTags(step, {
    PaymentRequestOpen: (request) =>
      answer(200, {
        type: "action",
        icon,
        title: m.payment_request_preview_open_title(named(request)),
        description:
          request.note ?? m.pay_request_action_description(named(request)),
        label: m.pay_request_action_label(named(request)),
      }),
    PaymentRequestPaid: (request) =>
      answer(200, {
        type: "action",
        icon,
        title: m.payment_request_preview_paid_title(named(request)),
        description: m.payment_request_preview_paid_description(),
        label: m.payment_request_status_paid(),
        disabled: true,
      }),
    PaymentRequestCancelled: (request) =>
      answer(200, {
        type: "action",
        icon,
        title: m.payment_request_preview_cancelled_title(named(request)),
        description: m.payment_request_preview_cancelled_description(),
        label: m.payment_request_status_cancelled(),
        disabled: true,
      }),
    PaymentRequestNotFound: missing,
  });

const transactionOf = (step: ExternalPaymentStep) =>
  Match.valueTags(step, {
    PaymentRequestTransaction: ({ request, transaction }) =>
      answer(200, {
        type: "transaction",
        transaction,
        message: m.pay_request_action_paying(named(request)),
      }),
    PaymentRequestPaid: () =>
      refused(409, m.payment_request_preview_paid_description()),
    PaymentRequestCancelled: () =>
      refused(409, m.payment_request_preview_cancelled_description()),
    PaymentRequestNotFound: missing,
    PaymentRequestBeingPaid: () => refused(409, m.pay_request_being_paid()),
    PaymentRequestSelfPay: () => refused(422, m.pay_request_self()),
    PaymentRequestRequesterUnavailable: () =>
      refused(409, m.pay_request_requester_cannot_receive()),
    PaymentRequestPayerUnfunded: () =>
      refused(422, m.pay_request_payer_unfunded()),
  });

const PaymentCall = Schema.fromJsonString(
  Schema.Struct({ account: AccountAddress }),
);

export const describePaymentRequest = (request: Request, idText: string) =>
  Option.match(Schema.decodeOption(PaymentRequestId)(idText), {
    onNone: async () => missing(),
    onSome: (id) =>
      outcomeOf(
        request,
        actionOf(new URL("/og-payment-request.png", request.url).href),
        RequestPayments.use((payments) => payments.read(id)),
      ),
  });

export const draftPaymentRequestTransaction = async (
  request: Request,
  idText: string,
) => {
  const id = Schema.decodeOption(PaymentRequestId)(idText);

  if (Option.isNone(id)) return missing();

  const call = Schema.decodeOption(PaymentCall)(await request.text());

  if (Option.isNone(call)) return refused(400, m.pay_request_account_invalid());

  return outcomeOf(
    request,
    transactionOf,
    RequestPayments.use((payments) =>
      payments.payExternally(id.value, call.value.account),
    ),
  );
};
