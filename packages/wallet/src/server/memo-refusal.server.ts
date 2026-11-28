import * as Option from "effect/Option";
import {
  ExternalRecipient,
  LinkRecipient,
  MemoNotAllowed,
  type ResolvedRecipient,
  type TransferOrder,
} from "../contract";

export const memoRefusal = (
  order: Pick<TransferOrder, "memo">,
  recipient: ResolvedRecipient,
): Option.Option<MemoNotAllowed> => {
  if (!order.memo || recipient instanceof ExternalRecipient)
    return Option.none();

  return Option.some(
    new MemoNotAllowed({
      reason: recipient instanceof LinkRecipient ? "payment_link" : "orchid",
    }),
  );
};
