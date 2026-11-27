import { type Address, address } from "@solana/kit";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Amount } from "../contract";
import type {
  AccountChain,
  AccountStanding,
} from "../server/chain-accounts.server";
import type { SolanaRpc } from "./rpc.server";
import { UsdcAccount, readUsdcAccount } from "./usdc-account.server";

const standingOf = (sponsor: Address) =>
  UsdcAccount.$match({
    Absent: (): AccountStanding => "absent",
    Foreign: (): AccountStanding => "foreign",
    Held: ({ closeAuthority }): AccountStanding =>
      Option.contains(closeAuthority, sponsor) ? "open" : "incomplete",
  });

const balanceOf = UsdcAccount.$match({
  Absent: () => Option.none<Amount>(),
  Foreign: () => Option.none<Amount>(),
  Held: ({ amount }) =>
    Option.some(Schema.decodeSync(Amount)(amount.toString())),
});

export const solanaAccountChain = (
  rpc: SolanaRpc,
  sponsor: Address,
): AccountChain => ({
  standing: (wallet) =>
    readUsdcAccount(rpc, address(wallet)).pipe(Effect.map(standingOf(sponsor))),
  balance: (wallet) =>
    readUsdcAccount(rpc, address(wallet)).pipe(Effect.map(balanceOf)),
});
