import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type {
  AccountAddress,
  PaymentRequestId,
  PositiveAmount,
} from "../contract";
import type { ChainUnreachable } from "./chain-errors.server";
import type { Settlement } from "./chain-settlement.server";

export interface ExternalPaymentTerms {
  readonly payer: AccountAddress;
  readonly requester: AccountAddress;
  readonly amount: PositiveAmount;
  readonly request: PaymentRequestId;
}

export class ExternalPayment extends Schema.Class<ExternalPayment>(
  "ExternalPayment",
)({
  reference: Schema.String,
  transaction: Schema.String,
  envelope: Schema.String,
  expiresAt: Schema.DateTimeUtcFromString,
}) {}

export interface RequestPaymentChain {
  draftExternalPayment(
    terms: ExternalPaymentTerms,
  ): Effect.Effect<ExternalPayment, ChainUnreachable>;
  externalPaymentSettlement(
    payment: ExternalPayment,
    terms: ExternalPaymentTerms,
  ): Effect.Effect<Settlement, ChainUnreachable>;
}
