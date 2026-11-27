import {
  FeeBumpTransaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { AccountAddress } from "../contract";
import type { ChainUnreachable } from "../server/chain-errors.server";
import {
  Applied,
  Expired,
  Rejected,
  type Sealed,
  type Settlement,
  Undecided,
} from "../server/chain-settlement.server";
import type { AccountState } from "./ledger.server";
import { networkPassphrase } from "./network";

export const resultCode = (
  transactionResult: xdr.TransactionResult,
): string => {
  const result = transactionResult.result;

  return result.type === "txFeeBumpInnerFailed"
    ? result.innerResultPair.result.result.type
    : result.type;
};

const lookupWindow = {
  latestLedger: Schema.Number,
  latestLedgerCloseTime: Schema.NumberFromString,
  oldestLedgerCloseTime: Schema.NumberFromString,
};

export const RawTransactionLookup = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("SUCCESS"),
    createdAt: Schema.NumberFromString,
    ...lookupWindow,
  }),
  Schema.Struct({
    status: Schema.Literal("FAILED"),
    resultXdr: Schema.String,
    ...lookupWindow,
  }),
  Schema.Struct({ status: Schema.Literal("NOT_FOUND"), ...lookupWindow }),
]);

type LookupWindow = {
  readonly latestLedger: number;
  readonly latestLedgerCloseTime: number;
  readonly oldestLedgerCloseTime: number;
};

export type TransactionLookup =
  | (LookupWindow & { readonly status: "SUCCESS"; readonly createdAt: number })
  | (LookupWindow & {
      readonly status: "FAILED";
      readonly resultXdr: xdr.TransactionResult;
    })
  | (LookupWindow & { readonly status: "NOT_FOUND" });

export const transactionLookup = (
  raw: typeof RawTransactionLookup.Type,
): TransactionLookup =>
  raw.status === "FAILED"
    ? {
        ...raw,
        resultXdr: xdr.TransactionResult.fromXDR(raw.resultXdr, "base64"),
      }
    : raw;

export function settlementFromResponse(
  response: TransactionLookup,
  sealed: Sealed,
  sender: Option.Option<AccountState>,
): Settlement {
  if (response.status === "SUCCESS")
    return new Applied({ at: DateTime.makeUnsafe(response.createdAt * 1000) });

  if (response.status === "FAILED") {
    const code = resultCode(response.resultXdr);

    if (code === "txFailed") return new Rejected({ code });
  }

  const envelope = TransactionBuilder.fromXDR(
    sealed.envelope,
    networkPassphrase,
  );

  const inner =
    envelope instanceof FeeBumpTransaction
      ? envelope.innerTransaction
      : envelope;

  const minTime = Number(inner.timeBounds?.minTime);

  if (
    Option.isSome(sender) &&
    sender.value.ledger >= response.latestLedger &&
    BigInt(sender.value.sequence) < BigInt(inner.sequence) &&
    response.oldestLedgerCloseTime <= minTime &&
    response.latestLedgerCloseTime * 1000 >
      DateTime.toEpochMillis(sealed.expiresAt)
  )
    return new Expired();

  if (
    response.status === "NOT_FOUND" &&
    Option.isSome(sender) &&
    response.latestLedger >= sender.value.ledger &&
    BigInt(sender.value.sequence) >= BigInt(inner.sequence) &&
    response.oldestLedgerCloseTime <= minTime
  )
    return new Rejected({ code: "sequence_consumed" });

  return new Undecided();
}

export interface SettlementReader {
  transaction(hash: string): Effect.Effect<TransactionLookup, ChainUnreachable>;
  account(
    address: AccountAddress,
  ): Effect.Effect<Option.Option<AccountState>, ChainUnreachable>;
}

export const resolveSettlement = Effect.fn("Chain.resolveSettlement")(
  function* (sealed: Sealed, reader: SettlementReader) {
    const envelope = TransactionBuilder.fromXDR(
      sealed.envelope,
      networkPassphrase,
    );

    const inner =
      envelope instanceof FeeBumpTransaction
        ? envelope.innerTransaction
        : envelope;

    const innerHash = Array.from(inner.hash(), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    const outerResponse = yield* reader.transaction(sealed.hash);
    const outer = settlementFromResponse(outerResponse, sealed, Option.none());

    if (
      Predicate.isTagged(outer, "Applied") ||
      Predicate.isTagged(outer, "Rejected")
    )
      return outer;

    const innerResponse =
      innerHash === sealed.hash
        ? outerResponse
        : yield* reader.transaction(innerHash);

    const found = settlementFromResponse(innerResponse, sealed, Option.none());

    if (
      Predicate.isTagged(found, "Applied") ||
      Predicate.isTagged(found, "Rejected")
    )
      return found;

    const sender = yield* reader.account(
      Schema.decodeSync(AccountAddress)(inner.source),
    );

    const confirmed = yield* reader.transaction(innerHash);

    return settlementFromResponse(confirmed, sealed, sender);
  },
);
