import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import {
  type AssetStep,
  BackupEnrollment,
  type EnrollStep,
  InvalidResponse,
  type OpenStep,
  OpeningPending,
  type Opened,
  type WalletClaim,
  type WalletUnavailable,
} from "../contract";
import { claimStanding } from "./claim-reviews";
import {
  type EnrollWalletOutcome,
  type EnrollmentDependencies,
  WalletEnrolled,
} from "./enrollment-records";
import { type Held, claimOf, sameCandidate } from "./enrollment-state";
import { PublicDeviceWallet, SealedDeviceWallet } from "./key-store";
import { type LinkCode, opensLink } from "./link-code";
import {
  concludedReceive,
  linkReceiveKind,
  receiveReviewOf,
  releaseReceive,
} from "./link-receive";
import { localEnvelopeVersion } from "./local-envelope";
import { reserveSponsorOf } from "./opening-drafts";
import {
  DraftRejected,
  type LinkReceiveReview,
  UnsupportedDevice,
  WalletOnDevice,
} from "./outcomes";
import { pollSchedule } from "./polling";
import { approveWithLinkCode } from "./signing";

type Committed = Opened | OpeningPending;

export const enrollmentRelease = (
  deps: EnrollmentDependencies,
  clearPending: Effect.Effect<void>,
  resign: (held: Held) => Effect.Effect<EnrollWalletOutcome>,
) => {
  const exclusive = deps.exclusive ?? (<A, E>(run: Effect.Effect<A, E>) => run);

  const awaitOpening = Effect.fn("Device.awaitEnrolledOpening")(function* (
    claim: WalletClaim,
  ): Effect.fn.Return<EnrollWalletOutcome> {
    const settled = yield* Effect.repeat(deps.port.open(claim, Option.none()), {
      schedule: pollSchedule<OpenStep>(
        (step) => Predicate.isTagged(step, "OpeningPending"),
        () => true,
      ),
    }).pipe(Effect.result);

    if (Result.isFailure(settled)) return new OpeningPending();

    return Predicate.isTagged(settled.success, "Opened")
      ? new WalletEnrolled({ profile: settled.success.profile })
      : new OpeningPending();
  });

  const refusedBeforeCommit = (outcome: EnrollWalletOutcome) =>
    clearPending.pipe(Effect.as<EnrollWalletOutcome>(outcome));

  const answerCommit = (
    held: Held,
    step: EnrollStep,
  ): Effect.Effect<Committed | EnrollWalletOutcome> =>
    Match.valueTags(step, {
      Opened: (opened) => Effect.succeed<Committed>(opened),
      OpeningPending: (pending) => Effect.succeed<Committed>(pending),
      OpeningDraft: () => resign(held),
      UsernameTaken: refusedBeforeCommit,
      ChallengeRefused: refusedBeforeCommit,
      RegistrationRefused: refusedBeforeCommit,
      AddressBound: () => refusedBeforeCommit(new InvalidResponse()),
      InvalidAddress: () => refusedBeforeCommit(new InvalidResponse()),
      NotSponsored: () => refusedBeforeCommit(new InvalidResponse()),
    });

  const commitAndInstall = Effect.fn("Device.commitEnrollment")(function* (
    held: Held,
  ): Effect.fn.Return<Committed | EnrollWalletOutcome> {
    const installed = yield* deps.store.readSealed().pipe(Effect.result);

    if (Result.isFailure(installed))
      return Match.valueTags(installed.failure, {
        CorruptDeviceWallet: (corrupt): EnrollWalletOutcome => corrupt,
        KeyStoreUnavailable: (): EnrollWalletOutcome => new UnsupportedDevice(),
      });

    if (
      Option.isSome(installed.success) &&
      !sameCandidate(installed.success.value, held.candidate)
    )
      return yield* refusedBeforeCommit(new WalletOnDevice());

    const reserveSponsor = Option.map(held.review, (review) =>
      reserveSponsorOf(review.draft),
    );

    if (Option.exists(reserveSponsor, Option.isNone))
      return yield* refusedBeforeCommit(new DraftRejected());

    const committed = yield* deps.port
      .enroll(
        new BackupEnrollment({
          ...held.enrollment,
          receiveOrderId: held.receive?.review.order.id,
        }),
        held.approvals,
      )
      .pipe(Effect.result);

    if (Result.isFailure(committed)) return committed.failure;

    const answered = yield* answerCommit(held, committed.success);

    if (
      !Predicate.isTagged(answered, "Opened") &&
      !Predicate.isTagged(answered, "OpeningPending")
    )
      return answered;

    if (Option.isSome(installed.success)) return answered;

    const written = yield* deps.store
      .installSealed(
        new SealedDeviceWallet({
          version: localEnvelopeVersion,
          public: new PublicDeviceWallet({
            address: held.candidate.address,
            username: held.candidate.username,
            backup: "stored",
            reserveSponsor: Option.flatten(reserveSponsor).pipe(
              Option.getOrUndefined,
            ),
          }),
          credential: held.candidate.credential,
          envelope: held.candidate.envelope,
        }),
      )
      .pipe(Effect.result);

    if (Result.isFailure(written))
      return Match.valueTags(written.failure, {
        CorruptDeviceWallet: (corrupt): EnrollWalletOutcome => corrupt,
        KeyStoreUnavailable: (): EnrollWalletOutcome => new UnsupportedDevice(),
      });

    return written.success
      ? answered
      : yield* clearPending.pipe(
          Effect.as<EnrollWalletOutcome>(new WalletOnDevice()),
        );
  });

  const receiveIntoOpened = Effect.fn("Device.receiveIntoEnrolledWallet")(
    function* (
      held: Held,
      shown: LinkReceiveReview,
      code: LinkCode | undefined,
    ): Effect.fn.Return<Option.Option<AssetStep>, WalletUnavailable> {
      const reserveSponsor = Option.flatMap(held.review, (review) =>
        reserveSponsorOf(review.draft),
      );

      if (
        code === undefined ||
        !opensLink(code, shown.link) ||
        Option.isNone(reserveSponsor)
      )
        return Option.none();

      const wallet = new PublicDeviceWallet({
        address: held.candidate.address,
        username: held.candidate.username,
        reserveSponsor: reserveSponsor.value,
      });

      const step = yield* deps.port.manage(shown.order, Option.none());

      if (!Predicate.isTagged(step, "AssetDraft"))
        return Option.some(
          yield* concludedReceive(deps.port, shown.order, step),
        );

      const derived = receiveReviewOf(wallet, shown.order, step, true, shown);

      const now = DateTime.toEpochMillis(yield* DateTime.now);

      if (
        Option.isNone(derived) ||
        claimStanding(linkReceiveKind, wallet, derived.value.review, now) !==
          "current"
      )
        return Option.none();

      return Option.some(
        yield* releaseReceive(
          deps.port,
          shown.order,
          approveWithLinkCode(code, [step.request])[0],
        ),
      );
    },
  );

  const release = Effect.fn("Device.releaseEnrollment")(function* (
    held: Held,
    committing: Effect.Effect<void> = Effect.void,
    code?: LinkCode,
  ): Effect.fn.Return<EnrollWalletOutcome> {
    yield* committing;

    const committed = yield* exclusive(commitAndInstall(held));

    if (
      !Predicate.isTagged(committed, "Opened") &&
      !Predicate.isTagged(committed, "OpeningPending")
    )
      return committed;

    const claim = claimOf(held);
    const { receive } = held;

    if (receive === undefined) yield* clearPending;

    const opened = Predicate.isTagged(committed, "OpeningPending")
      ? yield* awaitOpening(claim)
      : new WalletEnrolled({ profile: committed.profile });

    if (receive === undefined) return opened;

    if (!(opened instanceof WalletEnrolled))
      return yield* clearPending.pipe(Effect.as(opened));

    const received = yield* receiveIntoOpened(held, receive.review, code).pipe(
      Effect.result,
    );

    if (Result.isFailure(received)) return received.failure;

    yield* clearPending;

    return Option.match(received.success, {
      onNone: () => new WalletEnrolled({ profile: opened.profile }),
      onSome: (step) =>
        new WalletEnrolled({
          profile: opened.profile,
          received: step,
          receivedLink: receive.review.link,
        }),
    });
  });

  return release;
};
