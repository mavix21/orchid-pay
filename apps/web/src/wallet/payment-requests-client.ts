import {
  makePaymentRequestEffects,
  makeRequestPaymentEffects,
} from "@workspace/wallet";

import { paymentRequestPort } from "@/requests/payment-requests.functions";

import { deviceKeyStore, sealedDevice } from "./client";
import { port } from "./port.functions";

export const paymentRequestEffects = makePaymentRequestEffects(
  paymentRequestPort,
  deviceKeyStore,
);

export const requestPaymentEffects = makeRequestPaymentEffects(
  port,
  paymentRequestPort,
  deviceKeyStore,
  sealedDevice,
);
