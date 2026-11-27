import * as Match from "effect/Match";
import * as Option from "effect/Option";
import {
  ExternalMemoRequired,
  ExternalRecipient,
  LinkRecipient,
  MemoNotAllowed,
  type ResolvedRecipient,
  type TransferOrder,
} from "../contract";
import type { MemoRule } from "./Chain.server";

export const memoRefusal = (
  order: Pick<TransferOrder, "memo">,
  recipient: ResolvedRecipient,
  rule: MemoRule,
): Option.Option<ExternalMemoRequired | MemoNotAllowed> => {
  if (recipient instanceof LinkRecipient)
    return order.memo
      ? Option.some(new MemoNotAllowed({ reason: "payment_link" }))
      : Option.none();

  if (!(recipient instanceof ExternalRecipient))
    return order.memo
      ? Option.some(new MemoNotAllowed({ reason: "orchid" }))
      : Option.none();

  return Match.valueTags(rule, {
    MemoForbidden: () =>
      order.memo
        ? Option.some(new MemoNotAllowed({ reason: "muxed" }))
        : Option.none(),
    MemoOptional: () => Option.none(),
    MemoRequired: ({ account, exchange, source }) =>
      order.memo
        ? Option.none()
        : Option.some(
            new ExternalMemoRequired({ address: account, exchange, source }),
          ),
  });
};
