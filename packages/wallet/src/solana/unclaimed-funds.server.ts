import {
  address,
  getBase58Decoder,
  getBase64Encoder,
  getI64Decoder,
  getStructDecoder,
  getU64Decoder,
} from "@solana/kit";
import {
  ORCHID_LINKS_PROGRAM_ADDRESS,
  UNCLAIMED_FUNDS_DISCRIMINATOR,
  UNCLAIMED_FUNDS_SENDER_OFFSET,
  UNCLAIMED_FUNDS_SIZE,
  USDC_MINT_ADDRESS,
  type UnclaimedFunds,
  decodeUnclaimedFunds,
} from "@workspace/orchid-links";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  Asset,
  PositiveAmount,
  type UnclaimedFundsId,
} from "../contract";
import { rpcReadConcurrency } from "../server/settings.server";
import type {
  Claim,
  UnclaimedFundsEntry,
} from "../server/unclaimed-funds.server";
import type { ChainUnreachable } from "../server/chain-errors.server";
import { blockTimeOf, signaturesFor } from "./address-history.server";
import { solanaProfile } from "./profile";
import {
  RawAccount,
  type SolanaRpc,
  inContext,
  readCommitment,
} from "./rpc.server";
import { SolanaAccountAddress, SolanaUnclaimedFundsId } from "./schemas";

const accountsPerRequest = 100;

const closingSearchLimit = 100;

const clockSysvarAddress = address(
  "SysvarC1ock11111111111111111111111111111111",
);

const clockDecoder = getStructDecoder([
  ["slot", getU64Decoder()],
  ["epochStartTimestamp", getI64Decoder()],
  ["epoch", getU64Decoder()],
  ["leaderScheduleEpoch", getU64Decoder()],
  ["unixTimestamp", getI64Decoder()],
]);

const base64Encoder = getBase64Encoder();
const discriminator = getBase58Decoder().decode(UNCLAIMED_FUNDS_DISCRIMINATOR);

const ProgramAccounts = Schema.Array(
  Schema.Struct({ pubkey: Schema.String, account: RawAccount }),
);

const claimAnytime: Claim = {
  opensAt: Option.none(),
  claimableAt: () => true,
};

const reclaimOf = (held: UnclaimedFunds, chainTime: bigint): Claim => {
  const opensAt = DateTime.makeUnsafe(Number(held.reclaimableAt) * 1000);

  return {
    opensAt: Option.some(opensAt),
    claimableAt: (at) =>
      chainTime >= held.reclaimableAt &&
      DateTime.toEpochMillis(at) >= DateTime.toEpochMillis(opensAt),
  };
};

const entryOf = (
  unclaimedFunds: UnclaimedFundsId,
  held: UnclaimedFunds,
  sponsor: AccountAddress,
  chainTime: bigint,
): UnclaimedFundsEntry => ({
  unclaimedFunds,
  asset: Schema.decodeSync(Asset)(solanaProfile.baseAsset),
  amount: Schema.decodeSync(PositiveAmount)(held.amount.toString()),
  claimOf: (account) => {
    const claimer = address(account);

    if (claimer === held.link) return Option.some(claimAnytime);

    return claimer === held.sender
      ? Option.some(reclaimOf(held, chainTime))
      : Option.none();
  },
  paymentLinkFrom: (sender) =>
    address(sender) === held.sender && held.rentRecipient === address(sponsor)
      ? Option.some(Schema.decodeSync(SolanaAccountAddress)(held.link))
      : Option.none(),
});

const chainTimeOf = (clock: RawAccount) =>
  clockDecoder.decode(base64Encoder.encode(clock.data[0])).unixTimestamp;

const entryFrom = (
  unclaimedFunds: UnclaimedFundsId,
  account: RawAccount,
  sponsor: AccountAddress,
  chainTime: bigint,
): Option.Option<UnclaimedFundsEntry> => {
  if (account.owner !== ORCHID_LINKS_PROGRAM_ADDRESS) return Option.none();

  const held = decodeUnclaimedFunds(base64Encoder.encode(account.data[0]));

  return held === null || held.mint !== USDC_MINT_ADDRESS
    ? Option.none()
    : Option.some(entryOf(unclaimedFunds, held, sponsor, chainTime));
};

export interface SolanaUnclaimedFunds {
  unclaimedFunds(
    ids: ReadonlyArray<UnclaimedFundsId>,
  ): Effect.Effect<ReadonlyArray<UnclaimedFundsEntry>, ChainUnreachable>;
  unclaimedFundsFrom(
    sender: AccountAddress,
  ): Effect.Effect<ReadonlyArray<UnclaimedFundsEntry>, ChainUnreachable>;
  unclaimedFundsClosedAt(
    id: UnclaimedFundsId,
  ): Effect.Effect<Option.Option<DateTime.Utc>, ChainUnreachable>;
}

export const solanaUnclaimedFunds = (
  rpc: SolanaRpc,
  sponsor: AccountAddress,
): SolanaUnclaimedFunds => {
  const readAccounts = (ids: ReadonlyArray<UnclaimedFundsId>) =>
    rpc
      .call(
        "getMultipleAccounts",
        [
          [clockSysvarAddress, ...ids],
          { encoding: "base64", commitment: readCommitment },
        ],
        inContext(
          Schema.TupleWithRest(Schema.Tuple([RawAccount]), [
            Schema.NullOr(RawAccount),
          ]),
        ),
      )
      .pipe(
        Effect.map(({ value: [clock, ...accounts] }) =>
          Arr.zip(ids, accounts).flatMap(([id, account]) =>
            account === null
              ? []
              : Option.toArray(
                  entryFrom(id, account, sponsor, chainTimeOf(clock)),
                ),
          ),
        ),
      );

  const chainTime = rpc
    .call(
      "getAccountInfo",
      [clockSysvarAddress, { encoding: "base64", commitment: readCommitment }],
      inContext(RawAccount),
    )
    .pipe(Effect.map(({ value }) => chainTimeOf(value)));

  return {
    unclaimedFundsClosedAt: (id) =>
      signaturesFor(rpc, id, {
        before: Option.none(),
        until: Option.none(),
        limit: closingSearchLimit,
      }).pipe(
        Effect.map((entries) =>
          Option.fromUndefinedOr(
            entries.find((entry) => entry.err === null),
          ).pipe(Option.flatMap((entry) => blockTimeOf(entry.blockTime))),
        ),
      ),
    unclaimedFunds: (ids) =>
      Effect.forEach(
        Arr.chunksOf(Arr.dedupe(ids), accountsPerRequest - 1),
        readAccounts,
        { concurrency: rpcReadConcurrency },
      ).pipe(Effect.map(Arr.flatten)),
    unclaimedFundsFrom: (sender) =>
      Effect.all(
        [
          chainTime,
          rpc.call(
            "getProgramAccounts",
            [
              ORCHID_LINKS_PROGRAM_ADDRESS,
              {
                encoding: "base64",
                commitment: readCommitment,
                filters: [
                  { dataSize: UNCLAIMED_FUNDS_SIZE },
                  {
                    memcmp: {
                      offset: 0,
                      bytes: discriminator,
                      encoding: "base58",
                    },
                  },
                  {
                    memcmp: {
                      offset: UNCLAIMED_FUNDS_SENDER_OFFSET,
                      bytes: sender,
                      encoding: "base58",
                    },
                  },
                ],
              },
            ],
            ProgramAccounts,
          ),
        ],
        { concurrency: rpcReadConcurrency },
      ).pipe(
        Effect.map(([time, found]) =>
          found.flatMap(({ pubkey, account }) =>
            Option.toArray(
              entryFrom(
                Schema.decodeSync(SolanaUnclaimedFundsId)(pubkey),
                account,
                sponsor,
                time,
              ),
            ),
          ),
        ),
      ),
  };
};
