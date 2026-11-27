import { Memo } from "@stellar/stellar-sdk";
import * as Schema from "effect/Schema";
import { PaymentMemo } from "../contract";

export function toStellarMemo(memo?: PaymentMemo): Memo {
  return memo?.type === "text"
    ? Memo.text(memo.value)
    : memo
      ? Memo.id(memo.value)
      : Memo.none();
}

export function fromStellarMemo(memo: Memo): PaymentMemo | undefined {
  if (memo.type === "none") return undefined;

  const { value } = memo;

  return Schema.decodeUnknownSync(PaymentMemo)({
    type: memo.type,
    value:
      value instanceof Uint8Array
        ? new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(value)
        : value,
  });
}

export function sameMemo(
  left: PaymentMemo | undefined,
  right: PaymentMemo | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined &&
        left.type === right.type &&
        left.value === right.value;
}
