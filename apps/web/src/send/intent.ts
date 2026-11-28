import {
  type OtherAddressNetwork,
  DestinationAddress,
  AddressRecipient,
  type Asset,
  PaymentMemo,
  RecognisedAddress,
  type Recipient,
  TransferIntent,
  Username,
  UsernameRecipient,
  parseAmount,
  precisionOf,
  recogniseAddress,
} from "@workspace/wallet";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { m } from "@/paraglide/messages";

export type Destination = "username" | "address";

export type SendField = "recipient" | "amount" | "memo";

export class FieldProblem {
  constructor(
    readonly field: SendField,
    readonly message: string,
  ) {}
}

export type SendForm = {
  readonly recipient: string;
  readonly amount: string;
  readonly memo: string;
};

export const memoByteLimit = 28;

export const memoBytes = (memo: string) =>
  new TextEncoder().encode(memo.trim()).length;

export const otherNetworkName = (network: OtherAddressNetwork) =>
  Match.value(network).pipe(
    Match.when("evm", () => m.common_network_evm()),
    Match.when("tron", () => "Tron"),
    Match.when("bitcoin", () => "Bitcoin"),
    Match.exhaustive,
  );

const addressProblem = (typed: string) =>
  Option.match(recogniseAddress(typed), {
    onNone: () => m.common_address_invalid(),
    onSome: RecognisedAddress.$match({
      WalletNetworkAddress: () => m.common_address_invalid(),
      OtherNetworkAddress: ({ network }) =>
        m.send_other_network({ network: otherNetworkName(network) }),
    }),
  });

export const recipientOf = (
  destination: Destination,
  typed: string,
): Result.Result<Recipient, FieldProblem> =>
  Match.value(destination).pipe(
    Match.when("username", () =>
      Option.match(Schema.decodeOption(Username)(typed), {
        onNone: () =>
          Result.fail(new FieldProblem("recipient", m.send_username_invalid())),
        onSome: (value) => Result.succeed(UsernameRecipient.make({ value })),
      }),
    ),
    Match.when("address", () =>
      Option.match(Schema.decodeOption(DestinationAddress)(typed), {
        onNone: () =>
          Result.fail(new FieldProblem("recipient", addressProblem(typed))),
        onSome: (value) => Result.succeed(AddressRecipient.make({ value })),
      }),
    ),
    Match.exhaustive,
  );

const memoOf = (typed: string): Result.Result<PaymentMemo, FieldProblem> =>
  memoBytes(typed) > memoByteLimit
    ? Result.fail(new FieldProblem("memo", m.send_memo_too_long()))
    : Option.match(
        Schema.decodeOption(PaymentMemo)({ type: "text", value: typed }),
        {
          onNone: () =>
            Result.fail(new FieldProblem("memo", m.common_memo_invalid())),
          onSome: Result.succeed,
        },
      );

export function intentOf(
  form: SendForm,
  destination: Destination,
  asset: Asset,
): Result.Result<TransferIntent, FieldProblem> {
  const to = recipientOf(destination, form.recipient.trim());

  if (Result.isFailure(to)) return Result.fail(to.failure);

  const amount = parseAmount(
    form.amount.trim().replace(",", "."),
    precisionOf(asset),
  );

  if (Option.isNone(amount))
    return Result.fail(new FieldProblem("amount", m.common_amount_invalid()));

  const memo = form.memo.trim();

  if (destination === "username" || memo === "")
    return Result.succeed(
      new TransferIntent({ to: to.success, asset, amount: amount.value }),
    );

  return Result.map(
    memoOf(memo),
    (value) =>
      new TransferIntent({
        to: to.success,
        asset,
        amount: amount.value,
        memo: value,
      }),
  );
}
