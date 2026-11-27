import {
  type Instruction,
  type ReadonlyUint8Array,
  address,
} from "@solana/kit";
import * as Schema from "effect/Schema";
import { PaymentMemo } from "../contract";

export type TextMemo = Extract<PaymentMemo, { readonly type: "text" }>;

export const memoProgramAddress = address(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

export const memoInstructions = (
  memo: TextMemo | undefined,
): ReadonlyArray<Instruction> =>
  memo === undefined
    ? []
    : [
        {
          programAddress: memoProgramAddress,
          data: new TextEncoder().encode(memo.value),
        },
      ];

export const memoFromData = (data: ReadonlyUint8Array): TextMemo => {
  const memo: TextMemo = {
    type: "text",
    value: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      new Uint8Array(data),
    ),
  };

  Schema.decodeSync(PaymentMemo)(memo);

  return memo;
};

export const textMemoOf = (
  memo: PaymentMemo | undefined,
): TextMemo | undefined => {
  if (memo === undefined || memo.type === "text") return memo;

  throw new RangeError("A Solana payment carries only a text memo");
};
