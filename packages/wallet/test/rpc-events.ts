import { Address, xdr } from "@stellar/stellar-sdk";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { UnclaimedFundsId } from "../src/contract";
import { depositContract, usdc } from "../src/stellar/network";
import {
  bodyText,
  httpClientAnswering,
  jsonResponse,
  rpcError,
  rpcOk,
} from "./rpc-answering";

const scanLimit = 10_000;
const secondsPerLedger = 5;

interface EmulatedEvent {
  readonly id: string;
  readonly ledger: number;
  readonly txHash: string;
  readonly topic: ReadonlyArray<string>;
  readonly value: string;
}

export const ledgers = {
  oldestLedger: 100,
  latestLedger: 200,
  events: new Array<EmulatedEvent>(),
  maxEventsPerResponse: Number.POSITIVE_INFINITY,
  failingRequest: 0,
  eventRequests: 0,
  down: false,
};

export const resetLedgers = () => {
  ledgers.oldestLedger = 100;
  ledgers.latestLedger = 200;
  ledgers.events.length = 0;
  ledgers.maxEventsPerResponse = Number.POSITIVE_INFINITY;
  ledgers.failingRequest = 0;
  ledgers.eventRequests = 0;
  ledgers.down = false;
};

const encoded = (value: xdr.ScVal) => value.toXDR("base64");

const addressTopic = (address: string) =>
  encoded(new Address(address).toScVal());

const assetTopic = encoded(xdr.ScVal.scvString(`${usdc.code}:${usdc.issuer}`));

const amountValue = (amount: bigint) =>
  xdr.ScVal.scvI128(new xdr.Int128Parts({ hi: 0n, lo: amount }));

const toid = (ledger: number, transaction: number, operation = 0) =>
  (BigInt(ledger) << 32n) | (BigInt(transaction) << 12n) | BigInt(operation);

const position = (ledger: number, transaction: number) =>
  toid(ledger, transaction).toString().padStart(19, "0");

const eventId = (ledger: number, transaction: number, index: number) =>
  `${position(ledger, transaction)}-${index.toString().padStart(10, "0")}`;

const maxCursor = (ledger: number) =>
  `${toid(ledger, 1_048_575, 4095).toString().padStart(19, "0")}-4294967295`;

const closeSecondsAt = (ledger: number) =>
  Math.floor(Date.now() / 1000) -
  (ledgers.latestLedger - ledger) * secondsPerLedger;

const instant = (seconds: number) =>
  new Date(seconds * 1000).toISOString().replace(".000Z", "Z");

const nextIndex = (ledger: number, transaction: number) =>
  ledgers.events.filter((event) =>
    event.id.startsWith(position(ledger, transaction)),
  ).length;

export interface EventOptions {
  readonly ledger?: number;
  readonly transaction?: number;
  readonly hash?: string;
}

const recorded = (
  options: EventOptions,
  topic: ReadonlyArray<string>,
  value: xdr.ScVal,
) => {
  const ledger = options.ledger ?? ledgers.latestLedger;
  const transaction = options.transaction ?? 0;

  const event = {
    id: eventId(ledger, transaction, nextIndex(ledger, transaction)),
    ledger,
    txHash: options.hash ?? crypto.randomUUID().replaceAll("-", "").repeat(2),
    topic,
    value: encoded(value),
  };

  ledgers.events.push(event);

  return event;
};

export const paymentEvent = (
  from: string,
  to: string,
  amount: bigint,
  options: EventOptions = {},
) =>
  recorded(
    options,
    [
      encoded(xdr.ScVal.scvSymbol("transfer")),
      addressTopic(from),
      addressTopic(to),
      assetTopic,
    ],
    amountValue(amount),
  );

export const mintEvent = (
  to: string,
  amount: bigint,
  options: EventOptions = {},
) =>
  recorded(
    options,
    [encoded(xdr.ScVal.scvSymbol("mint")), addressTopic(to), assetTopic],
    amountValue(amount),
  );

export const muxedPaymentEvent = (
  from: string,
  to: string,
  amount: bigint,
  options: EventOptions = {},
) =>
  recorded(
    options,
    [
      encoded(xdr.ScVal.scvSymbol("transfer")),
      addressTopic(from),
      addressTopic(to),
      assetTopic,
    ],
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("amount"),
        val: amountValue(amount),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("to_muxed_id"),
        val: xdr.ScVal.scvU64(7n),
      }),
    ]),
  );

export const claimEvent = (
  unclaimedFunds: UnclaimedFundsId,
  to: string,
  amount: bigint,
  options: EventOptions = {},
) =>
  recorded(
    options,
    [
      encoded(xdr.ScVal.scvSymbol("transfer")),
      encoded(
        Address.claimableBalance(
          Uint8Array.from(Buffer.from(unclaimedFunds.slice(6), "hex")),
        ).toScVal(),
      ),
      addressTopic(to),
      assetTopic,
    ],
    amountValue(amount),
  );

export const unreadableEvent = (to: string, options: EventOptions = {}) =>
  recorded(
    options,
    [
      encoded(xdr.ScVal.scvSymbol("transfer")),
      "not-xdr",
      addressTopic(to),
      assetTopic,
    ],
    amountValue(1n),
  );

const EventsRequest = Schema.fromJsonString(
  Schema.Struct({
    method: Schema.String,
    params: Schema.optional(
      Schema.Struct({
        startLedger: Schema.optional(Schema.Number),
        filters: Schema.optional(
          Schema.Array(
            Schema.Struct({
              contractIds: Schema.Array(Schema.String),
              topics: Schema.Array(Schema.Array(Schema.String)),
            }),
          ),
        ),
        pagination: Schema.optional(
          Schema.Struct({
            cursor: Schema.optional(Schema.String),
            limit: Schema.optional(Schema.Number),
          }),
        ),
      }),
    ),
  }),
);

const ledgerOfCursor = (cursor: string) =>
  Number(BigInt(cursor.slice(0, 19)) >> 32n);

const matches = (
  event: EmulatedEvent,
  patterns: ReadonlyArray<ReadonlyArray<string>>,
) =>
  patterns.some(
    (pattern) =>
      pattern.length === event.topic.length &&
      pattern.every(
        (topic, index) => topic === "*" || topic === event.topic[index],
      ),
  );

const rangeError = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  error: {
    code: -32600,
    message: "startLedger must be within the ledger range",
  },
});

const eventsReply = (request: typeof EventsRequest.Type) => {
  ledgers.eventRequests += 1;

  if (ledgers.down || ledgers.eventRequests === ledgers.failingRequest)
    return rpcError;

  const params = request.params ?? {};
  const cursor = params.pagination?.cursor;

  const startLedger =
    cursor === undefined ? params.startLedger : ledgerOfCursor(cursor);

  if (
    startLedger === undefined ||
    startLedger < ledgers.oldestLedger ||
    startLedger > ledgers.latestLedger
  )
    return rangeError;

  const filter = params.filters?.[0];

  if (filter === undefined || !filter.contractIds.includes(depositContract))
    return rpcError;

  const endLedger = Math.min(ledgers.latestLedger + 1, startLedger + scanLimit);

  const limit = Math.min(
    params.pagination?.limit ?? 100,
    ledgers.maxEventsPerResponse,
  );

  const found = [...ledgers.events]
    .sort((left, right) => (left.id < right.id ? -1 : 1))
    .filter(
      (event) =>
        event.ledger >= startLedger &&
        event.ledger < endLedger &&
        (cursor === undefined || event.id > cursor) &&
        matches(event, filter.topics),
    );

  const page = found.slice(0, limit);
  const truncated = found.length > limit || page.length === limit;
  const last = page.at(-1);

  return rpcOk({
    events: page.map((event) => ({
      type: "contract",
      ledger: event.ledger,
      ledgerClosedAt: instant(closeSecondsAt(event.ledger)),
      contractId: depositContract,
      id: event.id,
      txHash: event.txHash,
      topic: event.topic,
      value: event.value,
    })),
    cursor:
      truncated && last !== undefined ? last.id : maxCursor(endLedger - 1),
    latestLedger: ledgers.latestLedger,
    oldestLedger: ledgers.oldestLedger,
    latestLedgerCloseTime: String(closeSecondsAt(ledgers.latestLedger)),
    oldestLedgerCloseTime: String(closeSecondsAt(ledgers.oldestLedger)),
  });
};

export const ledgersHttp = httpClientAnswering((request) =>
  Effect.sync(() => {
    const decoded = Schema.decodeSync(EventsRequest)(bodyText(request));

    if (decoded.method === "getHealth")
      return jsonResponse(
        ledgers.down
          ? rpcError
          : rpcOk({
              status: "healthy",
              latestLedger: ledgers.latestLedger,
              oldestLedger: ledgers.oldestLedger,
              ledgerRetentionWindow:
                ledgers.latestLedger - ledgers.oldestLedger,
            }),
      );

    return jsonResponse(
      decoded.method === "getEvents" ? eventsReply(decoded) : rpcError,
    );
  }),
);
