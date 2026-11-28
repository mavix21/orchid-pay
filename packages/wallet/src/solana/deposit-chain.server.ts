import { address, isAddress, isOffCurveAddress } from "@solana/kit";
import { USDC_MINT_ADDRESS } from "@workspace/orchid-links";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { AccountAddress } from "../contract";
import type {
  ChainDeposit,
  DepositChain,
  DepositPage,
  DepositPosition,
} from "../server/chain-deposits.server";
import { ChainUnreachable } from "../server/chain-errors.server";
import { rpcReadConcurrency } from "../server/settings.server";
import {
  type SignatureEntry,
  blockTimeOf,
  signaturesFor,
  signaturesPerRequest,
} from "./address-history.server";
import { usdcAccountOf } from "./program-addresses";
import { type SolanaRpc, readCommitment } from "./rpc.server";

const transactionsPerPage = 100;

const TokenBalance = Schema.Struct({
  accountIndex: Schema.Int,
  mint: Schema.String,
  owner: Schema.optional(Schema.String),
  uiTokenAmount: Schema.Struct({ amount: Schema.BigIntFromString }),
});

type TokenBalance = typeof TokenBalance.Type;

const RawTransaction = Schema.Struct({
  slot: Schema.Int,
  blockTime: Schema.optional(Schema.NullOr(Schema.Int)),
  transaction: Schema.Struct({
    message: Schema.Struct({
      accountKeys: Schema.Array(Schema.Struct({ pubkey: Schema.String })),
    }),
  }),
  meta: Schema.Struct({
    preTokenBalances: Schema.optional(Schema.Array(TokenBalance)),
    postTokenBalances: Schema.optional(Schema.Array(TokenBalance)),
  }),
});

type RawTransaction = typeof RawTransaction.Type;

const usdcUnits = (balances: ReadonlyArray<TokenBalance>, index: number) =>
  balances.find(
    (balance) =>
      balance.accountIndex === index && balance.mint === USDC_MINT_ADDRESS,
  )?.uiTokenAmount.amount ?? 0n;

const walletKey = (owner: string | undefined) =>
  owner !== undefined && isAddress(owner) && !isOffCurveAddress(owner)
    ? Option.some(owner)
    : Option.none();

const depositOf = (
  usdcAccount: string,
  entry: SignatureEntry,
  raw: RawTransaction,
  readAt: DateTime.Utc,
): Option.Option<ChainDeposit> => {
  const before = raw.meta.preTokenBalances ?? [];
  const after = raw.meta.postTokenBalances ?? [];

  const target = raw.transaction.message.accountKeys.findIndex(
    (key) => key.pubkey === usdcAccount,
  );

  const received =
    target < 0 ? 0n : usdcUnits(after, target) - usdcUnits(before, target);

  const senders = Arr.dedupe(
    before
      .filter(
        (balance) =>
          balance.mint === USDC_MINT_ADDRESS &&
          usdcUnits(after, balance.accountIndex) < balance.uiTokenAmount.amount,
      )
      .map((balance) => balance.owner),
  );

  const [sender] = senders;

  if (received <= 0n || senders.length !== 1) return Option.none();

  return Option.map(walletKey(sender), (from) => ({
    eventId: `${entry.signature}:${usdcAccount}`,
    from,
    amount: received,
    hash: entry.signature,
    ledger: raw.slot,
    closedAt: blockTimeOf(raw.blockTime ?? entry.blockTime).pipe(
      Option.getOrElse(() => readAt),
    ),
  }));
};

export const solanaDepositChain = (rpc: SolanaRpc): DepositChain => {
  const signaturesAfter = Effect.fn("Chain.depositSignatures")(function* (
    usdcAccount: string,
    after: Option.Option<DepositPosition>,
  ) {
    const found: Array<SignatureEntry> = [];
    let before = Option.none<string>();

    while (true) {
      const page = yield* signaturesFor(rpc, usdcAccount, {
        before,
        until: Option.map(after, (position) => position.cursor),
        limit: signaturesPerRequest,
      });

      found.push(...page);

      const oldest = page.at(-1);

      if (oldest === undefined || page.length < signaturesPerRequest)
        return Arr.reverse(found);

      before = Option.some(oldest.signature);
    }
  });

  const depositIn = Effect.fn("Chain.depositIn")(function* (
    usdcAccount: string,
    entry: SignatureEntry,
  ) {
    const reply = yield* rpc.call(
      "getTransaction",
      [
        entry.signature,
        {
          commitment: readCommitment,
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
        },
      ],
      Schema.Json,
    );

    if (reply === null)
      return yield* new ChainUnreachable({
        cause: new Error(`Transaction ${entry.signature} is not readable yet`),
      });

    const raw = Schema.decodeUnknownOption(RawTransaction)(reply);

    if (Option.isNone(raw)) {
      yield* Effect.logWarning(
        "Deposit transaction could not be read",
        entry.signature,
      );

      return Option.none<ChainDeposit>();
    }

    return depositOf(usdcAccount, entry, raw.value, yield* DateTime.now);
  });

  const pageOf = (
    usdcAccount: string,
    entries: Arr.NonEmptyReadonlyArray<SignatureEntry>,
  ) =>
    Effect.forEach(
      entries.filter((entry) => entry.err === null),
      (entry) => depositIn(usdcAccount, entry),
      { concurrency: rpcReadConcurrency },
    ).pipe(
      Effect.map((found): DepositPage => {
        const newest = Arr.lastNonEmpty(entries);

        return {
          deposits: found.flatMap(Option.toArray),
          position: { cursor: newest.signature, ledger: newest.slot },
        };
      }),
    );

  return {
    depositsInto: (wallet: AccountAddress, after) => {
      const usdcAccount = usdcAccountOf(address(wallet));

      return Stream.unwrap(
        Effect.map(signaturesAfter(usdcAccount, after), (entries) =>
          Stream.fromIterable(Arr.chunksOf(entries, transactionsPerPage)).pipe(
            Stream.mapEffect((chunk) => pageOf(usdcAccount, chunk)),
          ),
        ),
      );
    },
  };
};
