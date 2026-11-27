import {
  AccountState,
  TOKEN_PROGRAM_ADDRESS,
  getTokenDecoder,
  getTokenSize,
} from "@solana-program/token";
import { type Address, getBase64Encoder, unwrapOption } from "@solana/kit";
import { USDC_MINT_ADDRESS } from "@workspace/orchid-links";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { usdcAccountOf } from "./program-addresses";
import {
  RawAccount,
  type SolanaRpc,
  inContext,
  readCommitment,
} from "./rpc.server";

export type UsdcAccount = Data.TaggedEnum<{
  Absent: {};
  Foreign: {};
  Held: {
    readonly amount: bigint;
    readonly frozen: boolean;
    readonly closeAuthority: Option.Option<Address>;
  };
}>;

export const UsdcAccount = Data.taggedEnum<UsdcAccount>();

const base64Encoder = getBase64Encoder();

const usdcAccountFrom = (account: RawAccount, wallet: Address): UsdcAccount => {
  const bytes = base64Encoder.encode(account.data[0]);

  if (
    account.owner !== TOKEN_PROGRAM_ADDRESS ||
    bytes.length !== getTokenSize()
  )
    return UsdcAccount.Absent();

  const token = getTokenDecoder().decode(bytes);

  if (token.state === AccountState.Uninitialized) return UsdcAccount.Absent();

  if (token.mint !== USDC_MINT_ADDRESS || token.owner !== wallet)
    return UsdcAccount.Foreign();

  return UsdcAccount.Held({
    amount: token.amount,
    frozen: token.state === AccountState.Frozen,
    closeAuthority: Option.fromNullOr(unwrapOption(token.closeAuthority)),
  });
};

export const readUsdcAccount = (rpc: SolanaRpc, wallet: Address) =>
  rpc
    .call(
      "getAccountInfo",
      [
        usdcAccountOf(wallet),
        { encoding: "base64", commitment: readCommitment },
      ],
      inContext(Schema.NullOr(RawAccount)),
    )
    .pipe(
      Effect.map(({ value }) =>
        value === null ? UsdcAccount.Absent() : usdcAccountFrom(value, wallet),
      ),
    );
