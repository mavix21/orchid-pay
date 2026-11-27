import { address, getBase58Decoder, getBase64Encoder } from "@solana/kit";
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
import { solanaProfile } from "./profile";
import {
  RawAccount,
  type SolanaRpc,
  inContext,
  readCommitment,
} from "./rpc.server";
import { SolanaAccountAddress, SolanaUnclaimedFundsId } from "./schemas";

const accountsPerRequest = 100;

const base64Encoder = getBase64Encoder();
const discriminator = getBase58Decoder().decode(UNCLAIMED_FUNDS_DISCRIMINATOR);

const ProgramAccounts = Schema.Array(
  Schema.Struct({ pubkey: Schema.String, account: RawAccount }),
);

const claimAnytime: Claim = {
  opensAt: Option.none(),
  claimableAt: () => true,
};

const claimFrom = (opensAt: DateTime.Utc): Claim => ({
  opensAt: Option.some(opensAt),
  claimableAt: (at) =>
    DateTime.toEpochMillis(at) >= DateTime.toEpochMillis(opensAt),
});

const entryOf = (
  unclaimedFunds: UnclaimedFundsId,
  held: UnclaimedFunds,
  sponsor: AccountAddress,
): UnclaimedFundsEntry => ({
  unclaimedFunds,
  asset: Schema.decodeSync(Asset)(solanaProfile.baseAsset),
  amount: Schema.decodeSync(PositiveAmount)(held.amount.toString()),
  claimOf: (account) => {
    const claimer = address(account);

    if (claimer === held.link) return Option.some(claimAnytime);

    return claimer === held.sender
      ? Option.some(
          claimFrom(DateTime.makeUnsafe(Number(held.reclaimableAt) * 1000)),
        )
      : Option.none();
  },
  paymentLinkFrom: (sender) =>
    address(sender) === held.sender && held.rentRecipient === address(sponsor)
      ? Option.some(Schema.decodeSync(SolanaAccountAddress)(held.link))
      : Option.none(),
});

const entryFrom = (
  unclaimedFunds: UnclaimedFundsId,
  account: RawAccount,
  sponsor: AccountAddress,
): Option.Option<UnclaimedFundsEntry> => {
  if (account.owner !== ORCHID_LINKS_PROGRAM_ADDRESS) return Option.none();

  const held = decodeUnclaimedFunds(base64Encoder.encode(account.data[0]));

  return held === null || held.mint !== USDC_MINT_ADDRESS
    ? Option.none()
    : Option.some(entryOf(unclaimedFunds, held, sponsor));
};

export interface SolanaUnclaimedFunds {
  unclaimedFunds(
    ids: ReadonlyArray<UnclaimedFundsId>,
  ): Effect.Effect<ReadonlyArray<UnclaimedFundsEntry>, ChainUnreachable>;
  unclaimedFundsFrom(
    sender: AccountAddress,
  ): Effect.Effect<ReadonlyArray<UnclaimedFundsEntry>, ChainUnreachable>;
}

export const solanaUnclaimedFunds = (
  rpc: SolanaRpc,
  sponsor: AccountAddress,
): SolanaUnclaimedFunds => {
  const readAccounts = (ids: ReadonlyArray<UnclaimedFundsId>) =>
    rpc
      .call(
        "getMultipleAccounts",
        [ids, { encoding: "base64", commitment: readCommitment }],
        inContext(Schema.Array(Schema.NullOr(RawAccount))),
      )
      .pipe(
        Effect.map(({ value }) =>
          Arr.zip(ids, value).flatMap(([id, account]) =>
            account === null
              ? []
              : Option.toArray(entryFrom(id, account, sponsor)),
          ),
        ),
      );

  return {
    unclaimedFunds: (ids) =>
      Effect.forEach(
        Arr.chunksOf(Arr.dedupe(ids), accountsPerRequest),
        readAccounts,
        { concurrency: rpcReadConcurrency },
      ).pipe(Effect.map(Arr.flatten)),
    unclaimedFundsFrom: (sender) =>
      rpc
        .call(
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
        )
        .pipe(
          Effect.map((found) =>
            found.flatMap(({ pubkey, account }) =>
              Option.toArray(
                entryFrom(
                  Schema.decodeSync(SolanaUnclaimedFundsId)(pubkey),
                  account,
                  sponsor,
                ),
              ),
            ),
          ),
        ),
  };
};
