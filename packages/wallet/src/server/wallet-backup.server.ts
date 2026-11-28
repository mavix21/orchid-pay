import {
  type AuthenticationJSON,
  type RegistrationJSON,
  server,
} from "@passwordless-id/webauthn";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import {
  type Approvals,
  AssertionRefused,
  BackupEnrollment,
  BackupFound,
  ChallengeIssued,
  type ChallengePurpose,
  ChallengeRefused,
  type EnrollStep,
  type EnrollmentChallengeStep,
  type HumanCheckToken,
  NoBackup,
  type Opened,
  type OpeningPending,
  PasskeyAssertion,
  PasskeyChallenge,
  RegistrationRefused,
  SealedPhrase,
  SessionBegun,
  WalletClaim,
} from "../contract";
import { Backups, type StoredBackup } from "./Backups.server";
import type { ChainUnreachable } from "./Chain.server";
import { Directory, StoreFailure } from "./Directory.server";
import { Principal } from "./Principal.server";
import { HumanCheck, type HumanCheckUnavailable } from "./HumanCheck.server";
import { openingFlow } from "./wallet-opening.server";
import { wallets } from "./tables.server";
import { WalletSettings } from "./settings.server";
import { type Binding, unavailability } from "./username-standing.server";

const ClientData = Schema.fromJsonString(
  Schema.Struct({ challenge: Schema.String }),
);

const clientChallenge = (clientDataJSON: string) =>
  Schema.decodeUnknownOption(Schema.StringFromBase64Url)(clientDataJSON).pipe(
    Option.flatMap(Schema.decodeUnknownOption(ClientData)),
    Option.flatMap((data) =>
      Schema.decodeUnknownOption(PasskeyChallenge)(data.challenge),
    ),
  );

const verifiableAlgorithm = Schema.Literals(["ES256", "RS256"]);

export const backupFlow = Effect.gen(function* () {
  const { openWith } = yield* openingFlow;
  const backups = yield* Backups;
  const directory = yield* Directory;
  const humanCheck = yield* HumanCheck;
  const principal = yield* Principal;
  const settings = yield* WalletSettings;

  const allowedOrigin = (origin: string) =>
    settings.passkeyOrigins.includes(origin);

  const redeem = Effect.fn("Wallet.redeemChallenge")(function* (
    clientDataJSON: string,
    purpose: ChallengePurpose,
  ) {
    const challenge = clientChallenge(clientDataJSON);

    if (Option.isNone(challenge)) return Option.none<PasskeyChallenge>();

    return (yield* backups.consume(challenge.value, purpose))
      ? challenge
      : Option.none<PasskeyChallenge>();
  });

  const verifyEnrollment = (
    enrollment: BackupEnrollment,
    expectedChallenge: PasskeyChallenge,
  ) => {
    const { registration } = enrollment;

    const registrationJson: RegistrationJSON = {
      id: registration.id,
      rawId: registration.id,
      type: "public-key",
      clientExtensionResults: {},
      user: { name: `@${enrollment.username}` },
      response: {
        clientDataJSON: registration.clientDataJSON,
        authenticatorData: registration.authenticatorData,
        attestationObject: registration.attestationObject,
        publicKey: registration.publicKey,
        publicKeyAlgorithm: registration.publicKeyAlgorithm,
        transports: [...registration.transports],
      },
    };

    return Effect.tryPromise(() =>
      server.verifyRegistration(registrationJson, {
        challenge: expectedChallenge,
        origin: allowedOrigin,
        userVerified: true,
      }),
    ).pipe(
      Effect.option,
      Effect.map(
        Option.flatMap((verified) =>
          Schema.decodeUnknownOption(verifiableAlgorithm)(
            verified.credential.algorithm,
          ).pipe(
            Option.map((algorithm) => ({
              publicKey: verified.credential.publicKey,
              algorithm,
              counter: verified.authenticator.counter,
            })),
          ),
        ),
      ),
    );
  };

  const matchesCommittedBackup = (
    existing: StoredBackup,
    enrollment: BackupEnrollment,
    publicKey: string,
    algorithm: StoredBackup["algorithm"],
    submittedSealed: typeof SealedPhrase.Encoded,
  ) => {
    const storedSealed = Schema.encodeSync(SealedPhrase)(existing.sealed);

    return (
      existing.profile.address === enrollment.address &&
      existing.profile.username === enrollment.username &&
      existing.publicKey === publicKey &&
      existing.algorithm === algorithm &&
      storedSealed.iv === submittedSealed.iv &&
      storedSealed.ciphertext === submittedSealed.ciphertext
    );
  };

  const enrollmentChallenge = Effect.fn("Wallet.enrollmentChallenge")(
    function* (
      claim: WalletClaim,
      token: Option.Option<HumanCheckToken>,
    ): Effect.fn.Return<
      EnrollmentChallengeStep,
      StoreFailure | HumanCheckUnavailable
    > {
      const refused = unavailability(yield* directory.available(claim));

      if (Option.isSome(refused)) return refused.value;

      const verdict = yield* humanCheck.verify(token);

      if (Option.isSome(verdict)) return verdict.value;

      return new ChallengeIssued({
        challenge: yield* backups.issue("enrollment"),
      });
    },
  );

  const enroll = Effect.fn("Wallet.enroll")(function* (
    enrollment: BackupEnrollment,
    approvals: Approvals,
  ): Effect.fn.Return<EnrollStep, StoreFailure | ChainUnreachable> {
    const { registration } = enrollment;
    const parsedChallenge = clientChallenge(registration.clientDataJSON);

    if (Option.isNone(parsedChallenge)) return new ChallengeRefused();

    const challenge = parsedChallenge.value;
    const verified = yield* verifyEnrollment(enrollment, challenge);

    if (Option.isNone(verified))
      return (yield* backups.consume(challenge, "enrollment"))
        ? new RegistrationRefused()
        : new ChallengeRefused();

    const { publicKey, algorithm, counter } = verified.value;
    const sealed = Schema.encodeSync(SealedPhrase)(enrollment.sealed);

    const claim = new WalletClaim({
      username: enrollment.username,
      address: enrollment.address,
    });

    const matches = (stored: StoredBackup) =>
      matchesCommittedBackup(stored, enrollment, publicKey, algorithm, sealed);

    const existing = yield* backups.byCredential(registration.id);

    if (Option.isSome(existing) && !matches(existing.value))
      return new ChallengeRefused();

    if (Option.isNone(existing) && (yield* directory.bound(claim)))
      return new ChallengeRefused();

    const consumedHere = yield* Ref.make(false);

    const binding: Binding = {
      check: Effect.succeed(Option.none()),
      alongside: (tx) =>
        backups
          .commitEnrollment(tx, challenge, {
            credentialId: registration.id,
            address: enrollment.address,
            username: enrollment.username,
            publicKey,
            algorithm,
            counter,
            iv: sealed.iv,
            ciphertext: sealed.ciphertext,
          })
          .pipe(
            Effect.tap(() =>
              enrollment.receiveOrderId === undefined
                ? Effect.void
                : tx
                    .update(wallets)
                    .set({
                      enrollmentReceiveOrderId: enrollment.receiveOrderId,
                    })
                    .where(eq(wallets.address, enrollment.address))
                    .pipe(
                      Effect.asVoid,
                      Effect.mapError((cause) => new StoreFailure({ cause })),
                    ),
            ),
            Effect.tap(() => Ref.set(consumedHere, true)),
          ),
    };

    const step = yield* openWith(claim, Option.some(approvals), binding);

    const committed = Effect.fn("Wallet.enrollmentCommitted")(function* (
      opened: OpeningPending | Opened,
    ) {
      const [bound, stored] = yield* Effect.all([
        directory.bound(claim),
        backups.byCredential(registration.id),
      ]);

      if (!bound || !Option.exists(stored, matches))
        return new ChallengeRefused();

      if (yield* Ref.get(consumedHere))
        yield* principal.grant(enrollment.address, registration.id);

      return opened;
    });

    return yield* Match.valueTags(step, {
      OpeningPending: committed,
      Opened: committed,
      HumanCheckRefused: () => Effect.succeed(new ChallengeRefused()),
      OpeningDraft: Effect.succeed,
      UsernameTaken: Effect.succeed,
      AddressBound: Effect.succeed,
      InvalidAddress: Effect.succeed,
      NotSponsored: Effect.succeed,
    });
  });

  const assertedBackup = Effect.fn("Wallet.assertedBackup")(function* (
    assertion: PasskeyAssertion,
    purpose: ChallengePurpose,
  ): Effect.fn.Return<
    Result.Result<StoredBackup, ChallengeRefused | NoBackup | AssertionRefused>,
    StoreFailure
  > {
    const challenge = yield* redeem(assertion.clientDataJSON, purpose);

    if (Option.isNone(challenge)) return Result.fail(new ChallengeRefused());

    const found = yield* backups.byCredential(assertion.id);

    if (Option.isNone(found)) return Result.fail(new NoBackup());

    const backup = found.value;

    const authenticationJson: AuthenticationJSON = {
      id: assertion.id,
      rawId: assertion.id,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: assertion.clientDataJSON,
        authenticatorData: assertion.authenticatorData,
        signature: assertion.signature,
      },
    };

    const verified = yield* Effect.tryPromise(() =>
      server.verifyAuthentication(
        authenticationJson,
        {
          id: backup.credentialId,
          publicKey: backup.publicKey,
          algorithm: backup.algorithm,
          transports: [],
        },
        {
          challenge: challenge.value,
          origin: allowedOrigin,
          userVerified: true,
          counter: backup.counter,
        },
      ),
    ).pipe(Effect.option);

    if (Option.isNone(verified)) return Result.fail(new AssertionRefused());

    yield* backups.advance(backup.credentialId, verified.value.counter);
    yield* principal.grant(backup.profile.address, backup.credentialId);

    return Result.succeed(backup);
  });

  const restore = Effect.fn("Wallet.restore")(function* (
    assertion: PasskeyAssertion,
  ) {
    return Result.match(yield* assertedBackup(assertion, "restore"), {
      onFailure: (refusal) => refusal,
      onSuccess: (backup) =>
        new BackupFound({
          profile: backup.profile,
          sealed: backup.sealed,
          publicKey: backup.publicKey,
          algorithm: backup.algorithm,
        }),
    });
  });

  const beginSession = Effect.fn("Wallet.beginSession")(function* (
    assertion: PasskeyAssertion,
  ) {
    return Result.match(yield* assertedBackup(assertion, "session"), {
      onFailure: (refusal) => refusal,
      onSuccess: () => new SessionBegun(),
    });
  });

  return {
    restoreChallenge: () => backups.issue("restore"),
    sessionChallenge: () => backups.issue("session"),
    enrollmentChallenge,
    enroll,
    restore,
    beginSession,
  };
});
