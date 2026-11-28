import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  AssetCode,
  AssetId,
  PaymentRequestCancelled,
  PaymentRequestId,
  PaymentRequestNote,
  PaymentRequestOpen,
  PaymentRequestPaid,
  PositiveAmount,
  Username,
} from "../contract";
import { ExternalPayment } from "./chain-request-payments.server";
import type { externalPayments, paymentRequests } from "./tables.server";

export type PaymentRequestRow = typeof paymentRequests.$inferSelect;

export type ExternalPaymentRow = typeof externalPayments.$inferSelect;

export const requestOf = (row: PaymentRequestRow) => ({
  id: Schema.decodeSync(PaymentRequestId)(row.id),
  requester: Schema.decodeSync(Username)(row.requester),
  asset: {
    id: Schema.decodeSync(AssetId)(row.assetId),
    code: Schema.decodeSync(AssetCode)(row.assetCode),
  },
  amount: Schema.decodeSync(PositiveAmount)(row.amount.toString()),
  note:
    row.note === null
      ? undefined
      : Schema.decodeSync(PaymentRequestNote)(row.note),
  createdAt: DateTime.fromDateUnsafe(row.createdAt),
});

export const stepOf = (
  row: PaymentRequestRow,
  externalPaymentHash: string | null = null,
) => {
  const request = requestOf(row);

  switch (row.status) {
    case "open":
      return new PaymentRequestOpen(request);
    case "paid":
      return new PaymentRequestPaid(
        externalPaymentHash === null
          ? request
          : { ...request, externalPaymentHash },
      );
    case "cancelled":
      return new PaymentRequestCancelled(request);
  }
};

export interface ExternalBinding {
  readonly payment: ExternalPayment;
  readonly payer: AccountAddress;
  readonly requester: AccountAddress;
}

export interface RequestBinding {
  readonly payment: string;
  readonly expiresAt: Option.Option<DateTime.Utc>;
  readonly external: Option.Option<ExternalBinding>;
}

export interface InspectedRequest {
  readonly step:
    | PaymentRequestOpen
    | PaymentRequestPaid
    | PaymentRequestCancelled;
  readonly binding: Option.Option<RequestBinding>;
}

const externalBindingOf = (row: ExternalPaymentRow): ExternalBinding => ({
  payment: new ExternalPayment({
    reference: row.reference,
    transaction: row.transaction,
    envelope: row.envelope,
    expiresAt: DateTime.fromDateUnsafe(row.expiresAt),
  }),
  payer: Schema.decodeSync(AccountAddress)(row.payer),
  requester: Schema.decodeSync(AccountAddress)(row.requester),
});

export const inspectedOf = (
  row: PaymentRequestRow,
  external: ExternalPaymentRow | null,
): InspectedRequest => ({
  step: stepOf(row),
  binding: Option.map(Option.fromNullishOr(row.payment), (payment) => ({
    payment,
    expiresAt: Option.map(
      Option.fromNullishOr(row.paymentExpiresAt),
      DateTime.fromDateUnsafe,
    ),
    external: Option.map(Option.fromNullishOr(external), externalBindingOf),
  })),
});
