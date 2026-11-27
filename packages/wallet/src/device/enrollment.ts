import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import {
  BackupEnrollment,
  ChallengeIssued,
  RegistrationRefused,
  Username,
  WalletClaim,
} from "../contract";
import { type LinkCode, opensLink } from "./link-code";
import { network } from "../device-network";
import {
  AssertionIntent,
  AssertionRejected,
  verifyPinnedAssertion,
} from "./assertion";
import { type ReceiveSlot, enrollmentReceive } from "./enrollment-receive";
import {
  type EnrollWalletOutcome,
  type EnrollmentClient,
  type EnrollmentDependencies,
  type EnrollmentEffects,
  EnrollmentPending,
  type EnrollmentReceive,
  HeldReceive,
  PendingActivation,
  PendingCandidate,
  PendingRelease,
  type ReviewEnrollmentReceiveOutcome,
} from "./enrollment-records";
import {
  type Awaiting,
  type Created,
  type Held,
  PendingState,
  type Sealed,
  Verified,
  addressOf,
  credentialOf,
  isCreated,
  isHeld,
  memoryPendingStorage,
  notice,
  pinCredential,
  saltOf,
  sameCandidate,
  standingOfReview,
  withReview,
  zeroed,
} from "./enrollment-state";
import {
  CorruptEnvelope,
  freshInstallationSalt,
  localPhrasePrfInput,
  sealLocalEnvelope,
} from "./local-envelope";
import { receiveReviewJson } from "./link-receive";
import { reviewJson } from "./opening-drafts";
import {
  BackupUnsupported,
  DraftRejected,
  InvalidUsername,
  LinkCodeMismatch,
  NoWallet,
  OpeningReview,
  UnsupportedDevice,
  WalletOnDevice,
} from "./outcomes";
import { backupSalt, sealPhrase } from "./phrase-seal";
import { generateSecretPhrase } from "./secret-phrase";
import {
  approveWithLinkCode,
  approveWithPhrase,
  phraseAddress,
} from "./signing";

import { enrollmentChallenge } from "./enrollment-challenge";
import { candidateVerifier } from "./enrollment-verify";
import { enrollmentRelease } from "./enrollment-release";
import { enrollmentReviewRequest } from "./enrollment-review";

export * from "./enrollment-records";

export function makeEnrollmentEffects(
  deps: EnrollmentDependencies,
): EnrollmentEffects {
  let state: PendingState = PendingState.Idle();
  const receiving: ReceiveSlot = { review: Option.none() };
  const lock = Semaphore.makeUnsafe(1);
  const storage = deps.pending ?? memoryPendingStorage();

  const clearPending = Effect.gen(function* () {
    state = PendingState.Idle();
    receiving.review = Option.none();

    yield* storage.clear();
  });

  const pendingNotice = (current: Awaiting | Held) =>
    notice(current, receiving.review);

  const loadPending = Effect.gen(function* () {
    if (!PendingState.$is("Idle")(state)) return state;

    const restored = yield* storage.read();

    if (Option.isNone(restored)) return state;

    if (Predicate.isTagged(restored.value, "PendingActivation")) {
      const { enrollment, candidate, review } = restored.value;

      state = PendingState.Sealed({
        enrollment,
        candidate,
        review: Option.fromNullishOr(review),
      });

      return state;
    }

    const { enrollment, candidate, review, approvals, receive } =
      restored.value;

    state = PendingState.Held({
      enrollment,
      candidate,
      review: Option.fromNullishOr(review),
      approvals,
      receive,
    });

    return state;
  });

  const installedConflict = Effect.fn("Device.enrollmentInstalledConflict")(
    function* (
      current: PendingState,
    ): Effect.fn.Return<Option.Option<EnrollWalletOutcome>> {
      const installed = yield* deps.store.readSealed().pipe(Effect.result);

      if (Result.isFailure(installed))
        return Option.some<EnrollWalletOutcome>(
          Match.valueTags(installed.failure, {
            CorruptDeviceWallet: (corrupt) => corrupt,
            KeyStoreUnavailable: () => new UnsupportedDevice(),
          }),
        );

      if (Option.isNone(installed.success)) return Option.none();

      if (
        isHeld(current) &&
        sameCandidate(installed.success.value, current.candidate)
      )
        return Option.none();

      yield* clearPending;

      return Option.some<EnrollWalletOutcome>(new WalletOnDevice());
    },
  );

  const requestReview = enrollmentReviewRequest(deps.port);

  const refreshReview = Effect.fn("Device.refreshEnrollmentReview")(function* (
    current: Awaiting,
    redrafted: boolean,
  ): Effect.fn.Return<EnrollWalletOutcome> {
    const requested = yield* requestReview(current, redrafted).pipe(
      Effect.result,
    );

    if (Result.isFailure(requested)) return requested.failure;

    if (requested.success instanceof OpeningReview) {
      const next = withReview(current, Option.some(requested.success));

      state = next;

      return pendingNotice(next);
    }

    if (Predicate.isTagged(requested.success, "UsernameTaken"))
      yield* clearPending;

    return requested.success;
  });

  const resign = Effect.fn("Device.resignEnrollment")(function* (held: Held) {
    const refreshed = yield* refreshReview(
      PendingState.Sealed({
        enrollment: held.enrollment,
        candidate: held.candidate,
        review: Option.none(),
      }),
      true,
    );

    const current = state;

    if (
      !Predicate.isTagged(refreshed, "EnrollmentPending") ||
      !PendingState.$is("Sealed")(current) ||
      Option.isNone(current.review)
    )
      return refreshed;

    const written = yield* storage
      .write(
        new PendingActivation({
          enrollment: held.enrollment,
          candidate: held.candidate,
          review: current.review.value,
        }),
      )
      .pipe(Effect.result);

    if (Result.isFailure(written)) {
      state = held;

      return new UnsupportedDevice();
    }

    return new DraftRejected();
  });

  const release = enrollmentRelease(deps, clearPending, resign);

  const hasLiveReview = Effect.fn("Device.enrollmentHasLiveReview")(function* (
    current: Awaiting,
  ) {
    if (Option.isNone(current.review)) return false;

    return (
      (yield* standingOfReview(current, current.review.value)) === "current"
    );
  });

  const { receiveStanding, refreshReceive, reviewOpenLink } = enrollmentReceive(
    deps.port,
    receiving,
    pendingNotice,
  );

  const sealCandidate = Effect.fn("Device.sealEnrollmentCandidate")(function* (
    current: Created,
    review: Option.Option<OpeningReview>,
    devicePrf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
    backupPrf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
  ): Effect.fn.Return<Sealed | EnrollWalletOutcome> {
    const sealedBackup = yield* sealPhrase(
      Redacted.value(backupPrf),
      Redacted.value(current.phrase),
    );

    const sealedLocal = yield* sealLocalEnvelope(
      {
        phrase: Redacted.value(current.phrase),
        network,
        address: current.address,
        credentialId: current.credential.id,
        salt: current.salt,
      },
      devicePrf,
    );

    if (sealedLocal instanceof CorruptEnvelope)
      return yield* clearPending.pipe(Effect.as(sealedLocal));

    const candidate = new PendingCandidate({
      username: current.username,
      address: current.address,
      credential: current.credential,
      envelope: sealedLocal.envelope,
    });

    const enrollment = new BackupEnrollment({
      address: current.address,
      username: current.username,
      registration: current.registration,
      sealed: sealedBackup,
    });

    const written = yield* storage
      .write(
        new PendingActivation({
          enrollment,
          candidate,
          review: Option.getOrUndefined(review),
        }),
      )
      .pipe(Effect.result);

    if (Result.isFailure(written))
      return yield* clearPending.pipe(Effect.as(new UnsupportedDevice()));

    const next = PendingState.Sealed({
      enrollment,
      candidate,
      review,
    });

    state = next;

    return next;
  });

  const verifyCandidate = candidateVerifier(storage, clearPending);

  const sealAndSign = Effect.fn("Device.sealAndSignEnrollment")(function* (
    current: Awaiting,
    review: OpeningReview,
    devicePrf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
    backupPrf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
    receive: EnrollmentReceive | undefined,
  ): Effect.fn.Return<Held | EnrollWalletOutcome> {
    const sealed = isCreated(current)
      ? yield* sealCandidate(current, Option.some(review), devicePrf, backupPrf)
      : current;

    if (!Predicate.isTagged(sealed, "Sealed")) return sealed;

    const verified = yield* verifyCandidate(devicePrf, backupPrf);

    if (!(verified instanceof Verified)) return verified;

    if ((yield* standingOfReview(sealed, review)) !== "current")
      return yield* refreshReview(sealed, true);

    if (receive !== undefined) {
      if (!opensLink(receive.code, receive.review.link))
        return new LinkCodeMismatch();

      if ((yield* receiveStanding(sealed, receive.review)) !== "current")
        return yield* refreshReceive(sealed, receive.review);
    }

    const approvals = approveWithPhrase(verified.phrase, [
      review.draft.request,
    ]);

    const heldReceive =
      receive === undefined
        ? undefined
        : new HeldReceive({
            order: receive.review.order,
            approval: approveWithLinkCode(receive.code, [
              receive.review.draft.request,
            ])[0],
          });

    const written = yield* storage
      .write(
        new PendingRelease({
          enrollment: verified.enrollment,
          candidate: verified.candidate,
          review,
          approvals,
          receive: heldReceive,
        }),
      )
      .pipe(Effect.result);

    if (Result.isFailure(written))
      return yield* clearPending.pipe(Effect.as(new UnsupportedDevice()));

    const held = PendingState.Held({
      enrollment: verified.enrollment,
      candidate: verified.candidate,
      review: Option.some(review),
      approvals,
      receive: heldReceive,
    });

    state = held;

    return held;
  });

  const confirmWithPasskey = Effect.fn("Device.confirmEnrollmentWithPasskey")(
    function* (
      current: Awaiting,
      review: OpeningReview,
      receive: EnrollmentReceive | undefined,
      committing: Effect.Effect<void>,
    ): Effect.fn.Return<EnrollWalletOutcome> {
      const verified = yield* verifyPinnedAssertion(
        deps.assertions,
        deps.relyingParty,
        credentialOf(current),
        AssertionIntent.Operation({
          purpose: "approval",
          prf: {
            first: yield* localPhrasePrfInput({
              network,
              address: addressOf(current),
              salt: saltOf(current),
            }),
            second: Option.some(yield* backupSalt),
          },
        }),
      ).pipe(Effect.result);

      if (Result.isFailure(verified)) return verified.failure;

      return yield* Match.valueTags(verified.success, {
        OperationVerified: ({ prf }) =>
          Option.match(prf.second, {
            onNone: () =>
              clearPending.pipe(
                Effect.as<EnrollWalletOutcome>(new BackupUnsupported()),
                Effect.ensuring(zeroed(prf.first)),
              ),
            onSome: (backupPrf) =>
              sealAndSign(current, review, prf.first, backupPrf, receive).pipe(
                Effect.ensuring(
                  Effect.all([zeroed(prf.first), zeroed(backupPrf)]),
                ),
                Effect.flatMap((signed) =>
                  isHeld(signed)
                    ? release(signed, committing)
                    : Effect.succeed(signed),
                ),
              ),
          }),
        EntryVerified: () => Effect.succeed(new AssertionRejected()),
        WrongCredential: Effect.succeed,
        AssertionRejected: Effect.succeed,
        PrfOutputMissing: () =>
          clearPending.pipe(Effect.as(new BackupUnsupported())),
      });
    },
  );

  const activate = Effect.fn("Device.activateEnrollment")(function* (
    current: Awaiting,
    shown: OpeningReview | undefined,
    receive: EnrollmentReceive | undefined,
    committing: Effect.Effect<void>,
  ): Effect.fn.Return<EnrollWalletOutcome> {
    if (Option.isNone(current.review) || !(yield* hasLiveReview(current)))
      return yield* refreshReview(current, false);

    const review = current.review.value;

    if (shown === undefined || reviewJson(shown) !== reviewJson(review))
      return pendingNotice(current);

    if (receive !== undefined) {
      if (
        !Option.exists(
          receiving.review,
          (held) =>
            receiveReviewJson(held) === receiveReviewJson(receive.review),
        )
      )
        return pendingNotice(current);

      if (!opensLink(receive.code, receive.review.link))
        return new LinkCodeMismatch();

      if ((yield* receiveStanding(current, receive.review)) !== "current")
        return yield* refreshReceive(current, receive.review);
    }

    return yield* confirmWithPasskey(current, review, receive, committing);
  });

  const start = Effect.fn("Device.startEnrollment")(function* (
    usernameText: string,
  ): Effect.fn.Return<EnrollWalletOutcome> {
    const username = Schema.decodeUnknownOption(Username)(usernameText);

    if (Option.isNone(username)) return new InvalidUsername();

    const current = yield* loadPending;

    const blocked = yield* installedConflict(current);

    if (Option.isSome(blocked)) return blocked.value;

    if (!PendingState.$is("Idle")(current)) return pendingNotice(current);

    const phrase = generateSecretPhrase();

    const address = phraseAddress(phrase);

    const step = yield* enrollmentChallenge(
      deps.port,
      new WalletClaim({ username: username.value, address }),
    );

    if (!(step instanceof ChallengeIssued)) return step;

    const registered = yield* deps.registration
      .register({ challenge: step.challenge, username: username.value })
      .pipe(Effect.result);

    if (Result.isFailure(registered)) return registered.failure;

    if (Option.isNone(registered.success)) return new BackupUnsupported();

    const credential = pinCredential(registered.success.value);

    if (Option.isNone(credential)) return new RegistrationRefused();

    const created = PendingState.Created({
      username: username.value,
      address,
      phrase: Redacted.make(phrase),
      salt: freshInstallationSalt(),
      registration: registered.success.value,
      credential: credential.value,
      review: Option.none(),
    });

    state = created;

    return yield* refreshReview(created, false);
  });

  const advance = Effect.fn("Device.advanceEnrollment")(function* (
    shown: OpeningReview | undefined,
    receive: EnrollmentReceive | undefined,
    committing: Effect.Effect<void>,
  ): Effect.fn.Return<EnrollWalletOutcome> {
    const current = yield* loadPending;

    const blocked = yield* installedConflict(current);

    if (Option.isSome(blocked)) return blocked.value;

    return yield* PendingState.$match(current, {
      Idle: () => Effect.succeed(new NoWallet()),
      Created: (awaiting) => activate(awaiting, shown, receive, committing),
      Sealed: (awaiting) => activate(awaiting, shown, receive, committing),
      Held: (held) => release(held, committing),
    });
  });

  const discard = Effect.fn("Device.discardEnrollment")(function* () {
    const current = yield* loadPending;

    if (isHeld(current)) return false;

    yield* clearPending;

    return true;
  });

  const pending = Effect.fn("Device.pendingEnrollment")(function* () {
    const current = yield* loadPending;

    const blocked = yield* installedConflict(current);

    if (Option.isSome(blocked) || PendingState.$is("Idle")(current))
      return Option.none<EnrollmentPending>();

    if (isHeld(current)) return Option.some(pendingNotice(current));

    if (Option.isSome(current.review) && (yield* hasLiveReview(current)))
      return Option.some(pendingNotice(current));

    const refreshed = yield* refreshReview(current, false);

    if (PendingState.$is("Idle")(state))
      return Option.none<EnrollmentPending>();

    return Option.some(
      Predicate.isTagged(refreshed, "EnrollmentPending")
        ? refreshed
        : pendingNotice(withReview(current, Option.none())),
    );
  });

  const reviewReceive = Effect.fn("Device.reviewEnrollmentReceive")(function* (
    code: LinkCode,
  ): Effect.fn.Return<ReviewEnrollmentReceiveOutcome> {
    const current = yield* loadPending;

    const blocked = yield* installedConflict(current);

    if (Option.isSome(blocked) || PendingState.$is("Idle")(current))
      return new NoWallet();

    if (isHeld(current)) return pendingNotice(current);

    if (Option.isSome(current.review) && (yield* hasLiveReview(current)))
      return yield* reviewOpenLink(current, code);

    const requested = yield* requestReview(current, false).pipe(Effect.result);

    if (Result.isFailure(requested)) return requested.failure;

    if (Predicate.isTagged(requested.success, "UsernameTaken")) {
      yield* clearPending;

      return requested.success;
    }

    if (!(requested.success instanceof OpeningReview)) return requested.success;

    const reviewed = withReview(current, Option.some(requested.success));

    state = reviewed;

    return yield* reviewOpenLink(reviewed, code);
  });

  return {
    pending: () => lock.withPermit(pending()),
    start: (usernameText) => lock.withPermit(start(usernameText)),
    advance: (shown, receive, committing = Effect.void) =>
      lock.withPermit(advance(shown, receive, committing)),
    reviewReceive: (code) => lock.withPermit(reviewReceive(code)),
    discard: () => lock.withPermit(discard()),
  };
}

export function makeEnrollmentClient(
  deps: EnrollmentDependencies,
): EnrollmentClient {
  const effects = makeEnrollmentEffects(deps);

  return {
    pending: () => Effect.runPromise(effects.pending()),
    start: (usernameText) => Effect.runPromise(effects.start(usernameText)),
    advance: (shown, receive, onCommitting) =>
      Effect.runPromise(
        effects.advance(
          shown,
          receive,
          onCommitting === undefined ? Effect.void : Effect.sync(onCommitting),
        ),
      ),
    reviewReceive: (code) => Effect.runPromise(effects.reviewReceive(code)),
    discard: () => Effect.runPromise(effects.discard()),
  };
}
