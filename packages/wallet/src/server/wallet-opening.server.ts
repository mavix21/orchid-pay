import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  AddressBound,
  type Approval,
  type Approvals,
  HumanCheckRefused,
  type HumanCheckToken,
  InvalidAddress,
  NotSponsored,
  Opened,
  OpeningDraft,
  OpeningPending,
  OpenStep,
  Profile,
  UsernameTaken,
  WalletClaim,
} from "../contract";
import { Chain, ChainUnreachable, Sealed } from "./Chain.server";
import { Directory, StoreFailure, type WalletRow } from "./Directory.server";
import {
  type Binding,
  checkedBinding,
  unavailability,
} from "./username-standing.server";
import { HumanCheck } from "./HumanCheck.server";
import { type SealedOpening, openingAttempt } from "./opening-attempt.server";
import { ReconcileOpening, WorkQueue, announcer } from "./work-queue.server";
import { confirmedReads, live } from "./wallet-reads.server";

export const openingFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const directory = yield* Directory;
  const humanCheck = yield* HumanCheck;
  const { readStanding } = yield* confirmedReads;
  const announce = announcer(yield* WorkQueue);
  const unchecked = checkedBinding(Effect.succeed(Option.none()));

  const openedOrBound = Effect.fn("Wallet.openedOrBound")(function* (
    row: WalletRow,
    claim: WalletClaim,
  ): Effect.fn.Return<OpenStep, StoreFailure> {
    const profile = yield* directory.profile(row);

    return profile.username === claim.username
      ? new Opened({ profile })
      : new AddressBound({ profile });
  });

  const activated = (
    active:
      | Option.Option<Profile>
      | UsernameTaken
      | AddressBound
      | HumanCheckRefused,
  ): OpenStep => {
    if (
      Predicate.isTagged(active, "UsernameTaken") ||
      Predicate.isTagged(active, "AddressBound") ||
      active instanceof HumanCheckRefused
    )
      return active;

    return Option.isSome(active)
      ? new Opened({ profile: active.value })
      : new OpeningPending();
  };

  const activation = Effect.fn("Wallet.activation")(function* (
    row: WalletRow,
    claim: WalletClaim,
    binding: Binding,
  ): Effect.fn.Return<OpenStep, StoreFailure | ChainUnreachable> {
    const attempt = openingAttempt(row);

    if (Option.isSome(attempt) && attempt.value instanceof Sealed) {
      const settlement = yield* chain.settlement(attempt.value);

      if (
        Predicate.isTagged(settlement, "Undecided") &&
        !(yield* chain.pastOpeningWindow(attempt.value))
      )
        return new OpeningPending();
    }

    return activated(yield* directory.activate(row, claim, binding));
  });

  const reconcileOpening = Effect.fn("Wallet.reconcileOpening")(function* ({
    row,
    sealed,
  }: SealedOpening): Effect.fn.Return<
    boolean,
    StoreFailure | ChainUnreachable
  > {
    const settlement = yield* chain.settlement(sealed);

    const dead =
      Predicate.isTagged(settlement, "Rejected") ||
      Predicate.isTagged(settlement, "Expired") ||
      (yield* chain.pastOpeningWindow(sealed));

    const address = Schema.decodeSync(AccountAddress)(row.address);

    if ((yield* readStanding(address)) === "open") {
      const profile = yield* directory.profile(row);

      const step = activated(
        yield* directory.activate(row, new WalletClaim(profile), unchecked),
      );

      return !Predicate.isTagged(step, "Opened");
    }

    if (dead) {
      yield* directory.discardAttempt(row);

      return false;
    }

    yield* chain.submit(sealed).pipe(Effect.ignore);

    return true;
  });

  const lone = (approvals: Approvals): Option.Option<Approval> => {
    const [first, ...rest] = approvals;

    return rest.length === 0 ? Option.some(first) : Option.none();
  };

  const sealDraft = Effect.fn("Wallet.sealDraft")(function* (
    draft: OpeningDraft,
    approvals: Approvals,
    holder: AccountAddress,
  ) {
    const approval = lone(approvals);

    if (Option.isNone(approval)) return Option.none<Sealed>();

    return yield* chain
      .seal(draft.request, approval.value, holder)
      .pipe(Effect.option);
  });

  const openWith = Effect.fn("Wallet.open")(function* (
    claim: WalletClaim,
    approvals: Option.Option<Approvals>,
    binding: Binding,
  ): Effect.fn.Return<OpenStep, StoreFailure | ChainUnreachable> {
    if (!chain.validAddress(claim.address))
      return new InvalidAddress({ address: claim.address });

    const standing = yield* readStanding(claim.address);

    if (standing === "foreign" || standing === "foreignIncomplete")
      return new NotSponsored();

    const availability = yield* directory.available(claim);

    const refused = unavailability(availability);

    if (Option.isSome(refused)) return refused.value;

    const existing = yield* directory.byAddress(claim.address);
    const usable = standing === "open";

    if (Option.isNone(existing)) {
      const drafted = yield* chain.draftOpening(claim.address);
      const written = yield* directory.start(claim.address, drafted);

      if (written.status === "active") return new OpeningPending();

      const stored = openingAttempt(written);

      if (Option.isSome(stored))
        return stored.value instanceof OpeningDraft
          ? stored.value
          : new OpeningPending();

      const redrafted = yield* directory.draft(written, drafted);
      const committed = openingAttempt(redrafted);

      return Option.isSome(committed) && committed.value instanceof OpeningDraft
        ? committed.value
        : new OpeningPending();
    }

    const row = existing.value;

    if (row.status === "active") {
      if (usable) return yield* openedOrBound(row, claim);

      yield* directory.recover(row);

      return new OpeningPending();
    }

    if (usable && (yield* directory.bound(claim)))
      return yield* activation(row, claim, binding);

    const attempt = openingAttempt(row);

    if (Option.isSome(attempt) && attempt.value instanceof Sealed) {
      const settlement = yield* chain.settlement(attempt.value);

      const unfinished = Match.valueTags(settlement, {
        Undecided: () => true,
        Applied: () => false,
        Rejected: () => false,
        Expired: () => false,
      });

      if (Predicate.isTagged(settlement, "Applied"))
        return new OpeningPending();

      const expiredOpening =
        unfinished && (yield* chain.pastOpeningWindow(attempt.value));

      if (unfinished && !expiredOpening) {
        yield* chain.submit(attempt.value).pipe(Effect.ignore);

        return new OpeningPending();
      }

      if (expiredOpening && (yield* readStanding(claim.address)) === "open")
        return yield* activation(row, claim, binding);
    }

    if (
      Option.isSome(attempt) &&
      attempt.value instanceof OpeningDraft &&
      (yield* live(attempt.value.request))
    ) {
      const pending = attempt.value;

      if (Option.isNone(approvals)) return pending;

      const sealed = yield* sealDraft(pending, approvals.value, claim.address);

      if (Option.isNone(sealed)) return pending;

      const written = yield* directory.seal(row, sealed.value, claim, binding);

      if (
        Predicate.isTagged(written, "UsernameTaken") ||
        Predicate.isTagged(written, "AddressBound") ||
        written instanceof HumanCheckRefused
      )
        return written;

      const committed = openingAttempt(written);

      if (Option.isSome(committed) && committed.value instanceof Sealed) {
        yield* chain.submit(committed.value).pipe(Effect.ignore);
        yield* announce(new ReconcileOpening({ address: claim.address }));
      }

      return new OpeningPending();
    }

    const drafted = yield* chain.draftOpening(claim.address);
    const written = yield* directory.draft(row, drafted);
    const stored = openingAttempt(written);

    return Option.isSome(stored) && stored.value instanceof OpeningDraft
      ? stored.value
      : new OpeningPending();
  });

  const open = (
    claim: WalletClaim,
    approvals: Option.Option<Approvals>,
    token: Option.Option<HumanCheckToken>,
  ) => openWith(claim, approvals, checkedBinding(humanCheck.verify(token)));

  const resume = (profile: Profile) =>
    openWith(new WalletClaim(profile), Option.none(), unchecked);

  return { open, openWith, resume, reconcileOpening };
});
