import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  Applied,
  Expired,
  Rejected,
  Undecided,
} from "../server/chain-settlement.server";
import { type SolanaRpc, inContext } from "./rpc.server";

export interface SentTransaction {
  readonly signature: string;
  readonly lastValidBlockHeight: bigint;
  readonly draftedSlot: bigint;
}

const SignatureStatus = Schema.Struct({
  slot: Schema.Int,
  err: Schema.NullOr(
    Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Json)]),
  ),
  confirmationStatus: Schema.NullOr(
    Schema.Literals(["processed", "confirmed", "finalized"]),
  ),
});

type SignatureStatus = typeof SignatureStatus.Type;

const SignatureLookup = inContext(
  Schema.Tuple([Schema.NullOr(SignatureStatus)]),
);

const FinalizedTip = Schema.Struct({
  absoluteSlot: Schema.Int,
  blockHeight: Schema.Int,
});

const rejectionCode = (error: NonNullable<SignatureStatus["err"]>) =>
  Predicate.isString(error) ? error : Object.keys(error).join();

export const resolveSettlement = Effect.fn("Chain.resolveSettlement")(
  function* (rpc: SolanaRpc, sent: SentTransaction) {
    const lookUp = rpc.call(
      "getSignatureStatuses",
      [[sent.signature], { searchTransactionHistory: true }],
      SignatureLookup,
    );

    const conclude = Effect.fn("Chain.concludeSignatureStatus")(function* (
      status: SignatureStatus,
    ) {
      if (status.confirmationStatus !== "finalized") return new Undecided();

      if (status.err !== null)
        return new Rejected({ code: rejectionCode(status.err) });

      const blockTime = yield* rpc.call(
        "getBlockTime",
        [status.slot],
        Schema.NullOr(Schema.Int),
      );

      return new Applied({
        at:
          blockTime === null
            ? yield* DateTime.now
            : DateTime.makeUnsafe(blockTime * 1000),
      });
    });

    const {
      value: [landed],
    } = yield* lookUp;

    if (landed !== null) return yield* conclude(landed);

    const finalized = yield* rpc.call(
      "getEpochInfo",
      [{ commitment: "finalized" }],
      FinalizedTip,
    );

    if (BigInt(finalized.blockHeight) <= sent.lastValidBlockHeight)
      return new Undecided();

    const {
      context,
      value: [landedByThen],
    } = yield* lookUp;

    if (landedByThen !== null) return yield* conclude(landedByThen);

    if (context.slot < finalized.absoluteSlot) return new Undecided();

    const firstAvailableBlock = yield* rpc.call(
      "getFirstAvailableBlock",
      [],
      Schema.Int,
    );

    return BigInt(firstAvailableBlock) > sent.draftedSlot
      ? new Undecided()
      : new Expired();
  },
);
