import type { Database } from "@workspace/db";
import { type SQL, eq, or } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HumanCheckRefused, type WalletClaim } from "../contract";
import { StoreFailure } from "./store-failure.server";
import { usernames } from "./tables.server";
import type { Transaction } from "./transaction.server";
import {
  Available,
  type Binding,
  availability,
  decidedWithoutBinding,
} from "./username-standing.server";

type Executor = Pick<Database["Service"], "select">;

export const nameOrAddress = (claim: WalletClaim) =>
  or(
    eq(usernames.username, claim.username),
    eq(usernames.address, claim.address),
  );

export const boundNames = (executor: Executor, matching: SQL | undefined) =>
  executor
    .select({ username: usernames.username, address: usernames.address })
    .from(usernames)
    .where(matching);

export const prepareBind = Effect.fn("Directory.prepareBind")(function* (
  executor: Executor,
  claim: WalletClaim,
  binding: Binding,
) {
  const holders = yield* boundNames(executor, nameOrAddress(claim));

  if (Option.isSome(decidedWithoutBinding(claim, holders))) return "unchecked";

  const refused = yield* binding.check;

  return Option.isSome(refused) ? refused.value : "verified";
});

export const bind = Effect.fn("Directory.bind")(function* (
  tx: Transaction,
  claim: WalletClaim,
  prepared: "verified" | "unchecked",
  alongside: Binding["alongside"],
) {
  const holders = yield* boundNames(tx, nameOrAddress(claim));
  const decided = decidedWithoutBinding(claim, holders);

  if (Option.isSome(decided)) return decided.value;

  if (prepared !== "verified") return new HumanCheckRefused();

  const inserted = yield* tx
    .insert(usernames)
    .values(claim)
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    yield* alongside(tx);

    return new Available();
  }

  const raced = yield* boundNames(tx, nameOrAddress(claim));

  if (raced.length === 0)
    return yield* new StoreFailure({
      cause: new Error("Binding conflict without a holder"),
    });

  return availability(claim, raced);
});
