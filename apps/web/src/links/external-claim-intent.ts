import {
  DestinationAddress,
  ExternalLinkIntent,
  PaymentMemo,
  forbidsMemo,
  recogniseAddress,
} from "@workspace/wallet";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { memoByteLimit, memoBytes, otherNetworkName } from "@/send/intent";
import { m } from "@/paraglide/messages";

export type ExternalClaimField = "destination" | "memo";

export class ExternalClaimFieldProblem {
  constructor(
    readonly field: ExternalClaimField,
    readonly message: string,
  ) {}
}

export interface ExternalClaimForm {
  readonly destination: string;
  readonly memo: string;
}

const destinationProblem = (typed: string) =>
  Option.match(recogniseAddress(typed), {
    onNone: () => m.common_address_invalid(),
    onSome: (network) =>
      network === "stellar"
        ? m.common_address_invalid()
        : m.external_other_network({ network: otherNetworkName(network) }),
  });

export function externalClaimIntentOf(
  form: ExternalClaimForm,
): Result.Result<ExternalLinkIntent, ExternalClaimFieldProblem> {
  const typed = form.destination.trim();
  const decoded = Schema.decodeOption(DestinationAddress)(typed);

  if (
    Option.isNone(decoded) ||
    !Option.contains(recogniseAddress(typed), "stellar")
  )
    return Result.fail(
      new ExternalClaimFieldProblem("destination", destinationProblem(typed)),
    );

  const destination = decoded.value;

  if (forbidsMemo(destination))
    return Result.succeed(new ExternalLinkIntent({ destination }));

  const trimmed = form.memo.trim();

  if (trimmed === "")
    return Result.succeed(new ExternalLinkIntent({ destination }));

  if (memoBytes(trimmed) > memoByteLimit)
    return Result.fail(
      new ExternalClaimFieldProblem("memo", m.external_memo_too_long()),
    );

  return Option.match(
    Schema.decodeOption(PaymentMemo)({ type: "text", value: trimmed }),
    {
      onNone: () =>
        Result.fail(
          new ExternalClaimFieldProblem("memo", m.common_memo_invalid()),
        ),
      onSome: (memo) =>
        Result.succeed(new ExternalLinkIntent({ destination, memo })),
    },
  );
}
