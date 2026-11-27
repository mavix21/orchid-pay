import { getBase64Decoder } from "@solana/kit";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { SubmissionRejected } from "../server/Chain.server";
import { ChainUnreachable } from "../server/chain-errors.server";
import type { Sealed } from "../server/chain-settlement.server";
import { decodeSealedEnvelope } from "./envelope-codec";
import {
  type RpcRefusal,
  type SolanaRpc,
  preflightCommitment,
} from "./rpc.server";
import {
  SignatureError,
  rejectionCode,
  resolveSettlement,
} from "./settlement.server";
import type { SponsoredFailures } from "./sponsored-failures.server";
import { holderOf } from "./wire-transaction";

const simulationFailed = -32002;

const SimulationFailure = Schema.Struct({ err: SignatureError });

const base64Decoder = getBase64Decoder();

const sentOf = (sealed: Sealed) =>
  Effect.sync(() => {
    const decoded = Option.getOrThrow(decodeSealedEnvelope(sealed.envelope));

    return {
      ...decoded,
      signature: sealed.hash,
      holder: holderOf(decoded.transactionBytes),
    };
  });

const preflightOutcome = (
  refusal: RpcRefusal,
): Effect.Effect<void, ChainUnreachable | SubmissionRejected> => {
  const failure =
    refusal.code === simulationFailed
      ? Schema.decodeUnknownOption(SimulationFailure)(refusal.data)
      : Option.none();

  if (Option.isNone(failure))
    return Effect.fail(new ChainUnreachable({ cause: refusal }));

  return failure.value.err === "AlreadyProcessed"
    ? Effect.void
    : Effect.fail(
        new SubmissionRejected({ code: rejectionCode(failure.value.err) }),
      );
};

export const solanaSubmission = (
  rpc: SolanaRpc,
  failures: SponsoredFailures,
) => ({
  submit: Effect.fn("Chain.submit")(function* (sealed: Sealed) {
    const sent = yield* sentOf(sealed);

    if (!(yield* failures.admits(sent.holder)))
      return yield* new SubmissionRejected({ code: "sponsored_failure_limit" });

    yield* rpc
      .attempt(
        "sendTransaction",
        [
          base64Decoder.decode(sent.transactionBytes),
          { encoding: "base64", preflightCommitment },
        ],
        Schema.String,
      )
      .pipe(Effect.catchTag("RpcRefusal", preflightOutcome));
  }),
  settlement: Effect.fn("Chain.settlement")(function* (sealed: Sealed) {
    const sent = yield* sentOf(sealed);
    const settlement = yield* resolveSettlement(rpc, sent);

    if (Predicate.isTagged(settlement, "Rejected"))
      yield* failures.recordLanded(sent.holder, sent.signature);

    return settlement;
  }),
});
