import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  AddressBound,
  type HumanCheckRefused,
  Profile,
  Username,
  UsernameTaken,
  type WalletClaim,
} from "../contract";
import type {
  HumanCheckUnavailable,
  HumanCheckVerdict,
} from "./HumanCheck.server";
import type { usernames } from "./tables.server";
import type { Transaction } from "./transaction.server";
import type { StoreFailure } from "./Directory.server";
import { reserved } from "./usernames.server";

export type NameRow = Pick<
  typeof usernames.$inferSelect,
  "username" | "address"
>;

export class Available extends Schema.TaggedClass<Available>()(
  "Available",
  {},
) {}

export type Unavailable = UsernameTaken | AddressBound | HumanCheckRefused;

export type BindingCheck = Effect.Effect<
  HumanCheckVerdict,
  HumanCheckUnavailable
>;

export class BindingUnproven extends Data.TaggedError("BindingUnproven") {}

export interface Binding {
  readonly check: BindingCheck;
  readonly alongside: (
    tx: Transaction,
  ) => Effect.Effect<void, BindingUnproven | StoreFailure>;
}

export const checkedBinding = (check: BindingCheck): Binding => ({
  check,
  alongside: () => Effect.void,
});

export const unavailability = (
  availability: Available | Unavailable,
): Option.Option<Unavailable> =>
  Match.valueTags(availability, {
    Available: () => Option.none(),
    UsernameTaken: Option.some,
    AddressBound: Option.some,
    HumanCheckRefused: Option.some,
  });

export const profileOf = (name: NameRow) =>
  new Profile({
    address: Schema.decodeSync(AccountAddress)(name.address),
    username: Schema.decodeSync(Username)(name.username),
  });

export function availability(
  claim: WalletClaim,
  found: ReadonlyArray<NameRow>,
): Available | Unavailable {
  const own = found.find((name) => name.address === claim.address);

  if (own)
    return own.username === claim.username
      ? new Available()
      : new AddressBound({ profile: profileOf(own) });

  if (found.length > 0 || reserved(claim.username))
    return new UsernameTaken({ username: claim.username });

  return new Available();
}

export const decidedWithoutBinding = (
  claim: WalletClaim,
  holders: ReadonlyArray<NameRow>,
) => {
  const standing = availability(claim, holders);

  return holders.length > 0 || !Predicate.isTagged(standing, "Available")
    ? Option.some(standing)
    : Option.none();
};
