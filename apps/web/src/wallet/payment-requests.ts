import {
  type PaymentRequestEffects,
  type RequestPaymentEffects,
  loadFromServer,
} from "@workspace/wallet";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";

import { sessionLapse } from "./session-lapse";

const loaded = loadFromServer(() => import("./payment-requests-client"));

type Client = Effect.Success<typeof loaded>;

const withClient = <A>(use: (client: Client) => Effect.Effect<A>) =>
  loaded.pipe(
    Effect.flatMap(use),
    Effect.catch((failure) => Effect.succeed(failure)),
    Effect.tap((outcome) =>
      Effect.sync(() => {
        if (Predicate.isTagged(outcome, "SessionRequired")) sessionLapse.note();
      }),
    ),
  );

const withPaymentRequests = <A>(
  use: (requests: PaymentRequestEffects) => Effect.Effect<A>,
) => withClient((client) => use(client.paymentRequestEffects));

const withRequestPayments = <A>(
  use: (payments: RequestPaymentEffects) => Effect.Effect<A>,
) => withClient((client) => use(client.requestPaymentEffects));

export const paymentRequestEffects: PaymentRequestEffects = {
  create: (request) =>
    withPaymentRequests((requests) => requests.create(request)),
  open: () => withPaymentRequests((requests) => requests.open()),
  cancel: (id) => withPaymentRequests((requests) => requests.cancel(id)),
  activity: (before) =>
    withPaymentRequests((requests) => requests.activity(before)),
};

export const requestPaymentEffects: RequestPaymentEffects = {
  review: (request) =>
    withRequestPayments((payments) => payments.review(request)),
  confirm: (id, shown) =>
    withRequestPayments((payments) => payments.confirm(id, shown)),
  resume: (id, transfer) =>
    withRequestPayments((payments) => payments.resume(id, transfer)),
};
