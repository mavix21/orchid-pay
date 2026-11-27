import { Database } from "@workspace/db";
import { type SQL, and, eq, or } from "drizzle-orm";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  HumanCheckRefused,
  OpeningDraft,
  Profile,
  Username,
  WalletClaim,
} from "../contract";
import { epochAt, network } from "../record-network";
import type { Sealed } from "./Chain.server";
import { pruneAbandonedOpenings } from "./abandoned-openings.server";
import { markRecovered, noAttempt } from "./recovered-wallets.server";
import type { SealedOpening } from "./opening-attempt.server";
import { stuckOpenings } from "./opening-sweep.server";
import { walletLock } from "./slot.server";
import { StoreFailure } from "./store-failure.server";
import { usernames, wallets } from "./tables.server";
import {
  bind,
  boundNames,
  nameOrAddress,
  prepareBind,
} from "./username-binding.server";
import type { Transaction } from "./transaction.server";
import {
  type Binding,
  type BindingUnproven,
  type Unavailable,
  availability,
  profileOf,
  unavailability,
  type Available,
} from "./username-standing.server";

export { StoreFailure };

export type WalletRow = typeof wallets.$inferSelect;

export class Directory extends Context.Service<
  Directory,
  {
    byAddress(
      address: AccountAddress,
    ): Effect.Effect<Option.Option<WalletRow>, StoreFailure>;

    byUsername(
      username: Username,
    ): Effect.Effect<Option.Option<Profile>, StoreFailure>;

    profile(row: WalletRow): Effect.Effect<Profile, StoreFailure>;

    available(
      claim: WalletClaim,
    ): Effect.Effect<Available | Unavailable, StoreFailure>;

    bound(claim: WalletClaim): Effect.Effect<boolean, StoreFailure>;

    unopened(
      row: WalletRow,
    ): Effect.Effect<Option.Option<Profile>, StoreFailure>;

    start(
      address: AccountAddress,
      initial?: OpeningDraft,
    ): Effect.Effect<WalletRow, StoreFailure>;
    draft(
      row: WalletRow,
      draft: OpeningDraft,
    ): Effect.Effect<WalletRow, StoreFailure>;

    seal(
      row: WalletRow,
      sealed: Sealed,
      claim: WalletClaim,
      binding: Binding,
    ): Effect.Effect<WalletRow | Unavailable, StoreFailure>;
    activate(
      row: WalletRow,
      claim: WalletClaim,
      binding: Binding,
    ): Effect.Effect<Option.Option<Profile> | Unavailable, StoreFailure>;

    recover(row: WalletRow): Effect.Effect<void, StoreFailure>;
    discardAttempt(row: WalletRow): Effect.Effect<void, StoreFailure>;
    stuckOpenings(
      runStartedAt: DateTime.Utc,
    ): Effect.Effect<ReadonlyArray<SealedOpening>, StoreFailure>;
    readonly pruneAbandonedOpenings: Effect.Effect<void, StoreFailure>;
  }
>()("@workspace/wallet/server/Directory") {
  static readonly layer = Layer.effect(
    Directory,
    Effect.gen(function* () {
      const db = yield* Database;
      const scope = eq(wallets.network, network);

      const find = (address: AccountAddress) =>
        db
          .select()
          .from(wallets)
          .where(and(scope, eq(wallets.address, address)))
          .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

      const current = Effect.fn("Directory.current")(function* (
        row: WalletRow,
      ) {
        const found = yield* find(
          Schema.decodeSync(AccountAddress)(row.address),
        );

        if (Option.isNone(found))
          return yield* new StoreFailure({
            cause: new Error("Wallet disappeared"),
          });

        return found.value;
      });

      const lockRow = (tx: Transaction, matching: SQL | undefined) =>
        tx.select().from(wallets).where(matching).for("update");

      const unopened = Effect.fn("Directory.unopened")(function* (
        row: WalletRow,
      ) {
        if (row.status !== "opening") return Option.none<Profile>();

        const names = yield* boundNames(db, eq(usernames.address, row.address));

        return Option.fromNullishOr(names[0]).pipe(Option.map(profileOf));
      });

      const start = Effect.fn("Directory.start")(function* (
        address: AccountAddress,
        initial?: OpeningDraft,
      ) {
        const now = yield* Clock.currentTimeMillis;

        const inserted = yield* db
          .insert(wallets)
          .values({
            address,
            status: "opening",
            network,
            testnetEpoch: epochAt(now),
            attemptEnvelope: initial ? initial.request.envelope : null,
            attemptExpiresAt: initial
              ? DateTime.toDateUtc(initial.request.expiresAt)
              : null,
          })
          .onConflictDoNothing()
          .returning();

        if (inserted[0]) return inserted[0];

        const found = yield* find(address);

        if (Option.isNone(found))
          return yield* new StoreFailure({
            cause: new Error("Wallet belongs to another network"),
          });

        return found.value;
      });

      const draft = Effect.fn("Directory.draft")(function* (
        row: WalletRow,
        drafted: OpeningDraft,
      ) {
        const written = yield* db
          .update(wallets)
          .set({
            version: row.version + 1,
            attemptEnvelope: drafted.request.envelope,
            attemptHash: null,
            attemptExpiresAt: DateTime.toDateUtc(drafted.request.expiresAt),
          })
          .where(
            and(
              scope,
              eq(wallets.address, row.address),
              eq(wallets.version, row.version),
            ),
          )
          .returning();

        return written[0] ?? (yield* current(row));
      });

      const seal = Effect.fn("Directory.seal")(function* (
        row: WalletRow,
        sealed: Sealed,
        claim: WalletClaim,
        binding: Binding,
      ) {
        const unchanged = and(
          scope,
          eq(wallets.address, row.address),
          eq(wallets.version, row.version),
        );

        const prepared = yield* prepareBind(db, claim, binding);

        if (prepared instanceof HumanCheckRefused) return prepared;

        const outcome = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const owner = Schema.decodeSync(AccountAddress)(row.address);

            yield* tx.execute(walletLock(owner));

            const locked = yield* lockRow(tx, unchanged);

            if (!locked[0]) return undefined;

            const bound = yield* bind(tx, claim, prepared, binding.alongside);

            const refused = unavailability(bound);

            if (Option.isSome(refused)) return refused.value;

            const written = yield* tx
              .update(wallets)
              .set({
                version: row.version + 1,
                attemptEnvelope: sealed.envelope,
                attemptHash: sealed.hash,
                attemptExpiresAt: DateTime.toDateUtc(sealed.expiresAt),
              })
              .where(unchanged)
              .returning();

            return written[0];
          }),
        );

        if (
          Predicate.isTagged(outcome, "UsernameTaken") ||
          Predicate.isTagged(outcome, "AddressBound") ||
          outcome instanceof HumanCheckRefused
        )
          return outcome;

        return outcome ?? (yield* current(row));
      });

      const activate = Effect.fn("Directory.activate")(function* (
        row: WalletRow,
        claim: WalletClaim,
        binding: Binding,
      ) {
        const activatable = and(
          scope,
          eq(wallets.address, row.address),
          or(eq(wallets.status, "opening"), eq(wallets.status, "recovered")),
          eq(wallets.version, row.version),
        );

        const prepared = yield* prepareBind(db, claim, binding);

        if (prepared instanceof HumanCheckRefused) return prepared;

        return yield* db.transaction((tx) =>
          Effect.gen(function* () {
            const locked = yield* lockRow(tx, activatable);

            if (!locked[0]) return Option.none<Profile>();

            const bound = yield* bind(tx, claim, prepared, binding.alongside);

            const refused = unavailability(bound);

            if (Option.isSome(refused)) return refused.value;

            const now = yield* Clock.currentTimeMillis;

            const written = yield* tx
              .update(wallets)
              .set({
                status: "active",
                version: row.version + 1,
                testnetEpoch: epochAt(now),
                ...noAttempt,
              })
              .where(activatable)
              .returning();

            return written[0] ? Option.some(new Profile(claim)) : Option.none();
          }),
        );
      });

      const discardAttempt = (row: WalletRow) =>
        db
          .update(wallets)
          .set({ version: row.version + 1, ...noAttempt })
          .where(
            and(
              scope,
              eq(wallets.address, row.address),
              eq(wallets.version, row.version),
            ),
          )
          .pipe(Effect.asVoid);

      const byUsername = (username: Username) =>
        db
          .select({ username: usernames.username, address: usernames.address })
          .from(usernames)
          .innerJoin(wallets, eq(wallets.address, usernames.address))
          .where(
            and(
              scope,
              eq(usernames.username, username),
              eq(wallets.status, "active"),
            ),
          )
          .pipe(
            Effect.map((rows) =>
              Option.fromNullishOr(rows[0]).pipe(Option.map(profileOf)),
            ),
          );

      const profile = Effect.fn("Directory.profile")(function* (
        row: WalletRow,
      ) {
        const bound = yield* boundNames(db, eq(usernames.address, row.address));

        if (!bound[0])
          return yield* new StoreFailure({
            cause: new Error("Wallet has no bound username"),
          });

        return profileOf(bound[0]);
      });

      const proven = <A, E>(
        program: Effect.Effect<A, E | BindingUnproven>,
      ): Effect.Effect<A | HumanCheckRefused, E> =>
        Effect.catchTag(program, "BindingUnproven", () =>
          Effect.succeed(new HumanCheckRefused()),
        );

      const wrap = <A, E>(program: Effect.Effect<A, E>) =>
        program.pipe(Effect.mapError((cause) => new StoreFailure({ cause })));

      return Directory.of({
        byAddress: (address) => wrap(find(address)),
        byUsername: (username) => wrap(byUsername(username)),
        profile: (row) => wrap(profile(row)),
        available: (claim) =>
          wrap(
            boundNames(db, nameOrAddress(claim)).pipe(
              Effect.map((found) => availability(claim, found)),
            ),
          ),
        bound: (claim) =>
          wrap(
            boundNames(
              db,
              and(
                eq(usernames.username, claim.username),
                eq(usernames.address, claim.address),
              ),
            ).pipe(Effect.map((found) => found.length > 0)),
          ),
        unopened: (row) => wrap(unopened(row)),
        start: (address, initial) => wrap(start(address, initial)),
        draft: (row, request) => wrap(draft(row, request)),
        seal: (row, sealed, claim, binding) =>
          wrap(proven(seal(row, sealed, claim, binding))),
        activate: (row, claim, binding) =>
          wrap(proven(activate(row, claim, binding))),
        recover: (row) =>
          wrap(markRecovered(row).pipe(Effect.provideService(Database, db))),
        discardAttempt: (row) => wrap(discardAttempt(row)),
        stuckOpenings: (runStartedAt) =>
          wrap(
            stuckOpenings(runStartedAt).pipe(
              Effect.provideService(Database, db),
            ),
          ),
        pruneAbandonedOpenings: wrap(
          pruneAbandonedOpenings().pipe(Effect.provideService(Database, db)),
        ),
      });
    }),
  );
}
