import { createServerFn } from "@tanstack/react-start";
import {
  AccountAddress,
  ActivityCursor,
  Approval,
  CancelPaymentRequestStep,
  CreatePaymentRequestStep,
  NewPaymentRequest,
  OpenPaymentRequestsStep,
  PayPaymentRequestStep,
  PaymentRequestId,
  type PaymentRequestPort,
  PaymentRequestStep,
  RequestActivityStep,
  type RequestPaymentsPort,
  TransferOrder,
} from "@workspace/wallet";
import { PaymentRequests, RequestPayments } from "@workspace/wallet/server";
import * as Schema from "effect/Schema";
import {
  answerPaymentRequests,
  answerRequestPayments,
  publicly,
  speakingFor,
} from "../server/wallet.server";
import { accepted, reach } from "@/wallet/reach";

const CreateCall = Schema.Struct({
  address: AccountAddress,
  request: NewPaymentRequest,
});

const ReadCall = Schema.Struct({ id: PaymentRequestId });

const OpenCall = Schema.Struct({ address: AccountAddress });

const CancelCall = Schema.Struct({
  address: AccountAddress,
  id: PaymentRequestId,
});

const PayCall = Schema.Struct({
  id: PaymentRequestId,
  order: TransferOrder,
  approval: Schema.OptionFromNullOr(Approval),
});

const ActivityCall = Schema.Struct({
  address: AccountAddress,
  before: Schema.optional(ActivityCursor),
});

const createRequestFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof CreateCall.Encoded>())
  .handler(({ data }) =>
    answerPaymentRequests(
      CreateCall,
      data,
      CreatePaymentRequestStep,
      (decoded) =>
        speakingFor(
          decoded.address,
          PaymentRequests.use((requests) =>
            requests.create(decoded.address, decoded.request),
          ),
        ),
    ),
  );

const readRequestFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof ReadCall.Encoded>())
  .handler(({ data }) =>
    answerRequestPayments(ReadCall, data, PaymentRequestStep, (decoded) =>
      publicly(RequestPayments.use((payments) => payments.read(decoded.id))),
    ),
  );

const openRequestsFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof OpenCall.Encoded>())
  .handler(({ data }) =>
    answerRequestPayments(OpenCall, data, OpenPaymentRequestsStep, (decoded) =>
      speakingFor(
        decoded.address,
        RequestPayments.use((payments) => payments.open(decoded.address)),
      ),
    ),
  );

const cancelRequestFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof CancelCall.Encoded>())
  .handler(({ data }) =>
    answerRequestPayments(
      CancelCall,
      data,
      CancelPaymentRequestStep,
      (decoded) =>
        speakingFor(
          decoded.address,
          RequestPayments.use((payments) =>
            payments.cancel(decoded.address, decoded.id),
          ),
        ),
    ),
  );

const payRequestFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof PayCall.Encoded>())
  .handler(({ data }) =>
    answerRequestPayments(PayCall, data, PayPaymentRequestStep, (decoded) =>
      speakingFor(
        decoded.order.from,
        RequestPayments.use((payments) =>
          payments.pay(decoded.id, decoded.order, decoded.approval),
        ),
      ),
    ),
  );

const requestActivityFn = createServerFn({ method: "POST" })
  .validator(accepted<typeof ActivityCall.Encoded>())
  .handler(({ data }) =>
    answerRequestPayments(ActivityCall, data, RequestActivityStep, (decoded) =>
      speakingFor(
        decoded.address,
        RequestPayments.use((payments) =>
          payments.activity(decoded.address, decoded.before),
        ),
      ),
    ),
  );

export const paymentRequestPort: PaymentRequestPort & RequestPaymentsPort = {
  create: (address, request) =>
    reach(
      CreatePaymentRequestStep,
      CreateCall,
      { address, request },
      createRequestFn,
    ),
  read: (id) => reach(PaymentRequestStep, ReadCall, { id }, readRequestFn),
  open: (address) =>
    reach(OpenPaymentRequestsStep, OpenCall, { address }, openRequestsFn),
  cancel: (address, id) =>
    reach(
      CancelPaymentRequestStep,
      CancelCall,
      { address, id },
      cancelRequestFn,
    ),
  pay: (id, order, approval) =>
    reach(
      PayPaymentRequestStep,
      PayCall,
      { id, order, approval },
      payRequestFn,
    ),
  activity: (address, before) =>
    reach(
      RequestActivityStep,
      ActivityCall,
      { address, before },
      requestActivityFn,
    ),
};
