import {
  Account,
  MuxedAccount,
  extractBaseAddress,
} from "@stellar/stellar-sdk";
import * as Schema from "effect/Schema";
import { AccountAddress, type DestinationAddress } from "../contract";

export const baseAccountOf = (destination: DestinationAddress) =>
  Schema.decodeSync(AccountAddress)(extractBaseAddress(destination));

const muxedPrefixLength = 53;

const highBitMuxedId = "9223372036854775808";

export const muxedPrefixesOf = (account: AccountAddress) =>
  ["0", highBitMuxedId].map((id) =>
    new MuxedAccount(new Account(account, "0"), id)
      .accountId()
      .slice(0, muxedPrefixLength),
  );
