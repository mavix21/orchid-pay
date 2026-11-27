import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Result from "effect/Result";
import type {
  Approval,
  PaymentRequestId,
  TransferOrder,
  TransferStep,
  WalletPort,
  WalletUnavailable,
} from "../contract";

export interface TransferRoute<R> {
  readonly paymentRequest: PaymentRequestId | undefined;
  transfer(
    order: TransferOrder,
    approval: Option.Option<Approval>,
  ): Effect.Effect<Result.Result<TransferStep, R>, WalletUnavailable>;
}

export const directRoute = (port: WalletPort): TransferRoute<never> => ({
  paymentRequest: undefined,
  transfer: (order, approval) =>
    Effect.map(port.transfer(order, approval), Result.succeed),
});
