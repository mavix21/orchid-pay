import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  PayPaymentRequestRefusal,
  type PayPaymentRequestStep,
  type PaymentRequestId,
  type RequestPaymentsPort,
  type WalletPort,
} from "../contract";
import type { KeyStore } from "./key-store";
import { type Reviews, sendTransfer } from "./sending";
import type { TransferRoute } from "./transfer-route";

const isRefusal = Schema.is(PayPaymentRequestRefusal);

const answerOf = (step: PayPaymentRequestStep) =>
  isRefusal(step) ? Result.fail(step) : Result.succeed(step);

const requestRoute = (
  payments: Pick<RequestPaymentsPort, "pay">,
  id: PaymentRequestId,
): TransferRoute<PayPaymentRequestRefusal> => ({
  paymentRequest: id,
  transfer: (order, approval) =>
    Effect.map(payments.pay(id, order, approval), answerOf),
});

export const requestTransfer = (
  wallet: WalletPort,
  payments: Pick<RequestPaymentsPort, "pay">,
  id: PaymentRequestId,
  store: KeyStore,
  reviews: Reviews,
) => sendTransfer(wallet, requestRoute(payments, id), store, reviews);
