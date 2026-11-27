import { sql } from "drizzle-orm";
import * as Schema from "effect/Schema";
import type { AccountAddress } from "../contract";

export const walletLock = (address: AccountAddress) =>
  sql`select pg_advisory_xact_lock(hashtextextended(${address}, 0))`;

export class SlotOccupied extends Schema.TaggedClass<SlotOccupied>()(
  "SlotOccupied",
  {},
) {}

export class WalletInactive extends Schema.TaggedClass<WalletInactive>()(
  "WalletInactive",
  {},
) {}
