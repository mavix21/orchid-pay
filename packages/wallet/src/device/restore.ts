import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import {
  AssertionRefused,
  type BackupFound,
  type Profile,
  type SealedPhrase,
  type WalletPort,
  type WalletUnavailable,
} from "../contract";
import { network } from "../device-network";
import {
  AssertionIntent,
  PinnedCredential,
  verifyPinnedAssertion,
} from "./assertion";
import type {
  CorruptDeviceWallet,
  KeyStoreUnavailable,
  SealedDevice,
} from "./key-store";
import { PublicDeviceWallet, SealedDeviceWallet } from "./key-store";
import {
  freshInstallationSalt,
  localEnvelopeVersion,
  localPhrasePrfInput,
  openLocalEnvelope,
  sealLocalEnvelope,
} from "./local-envelope";
import {
  BackupLocated,
  BackupMismatch,
  BackupUnsupported,
  type RestoreOutcome,
  RestoreUnverified,
  Restored,
  UnsupportedDevice,
} from "./outcomes";
import type { PasskeyCancelled, PasskeyFailed, Passkeys } from "./passkeys";
import { backupSalt, openPhrase } from "./phrase-seal";
import { phraseAddress } from "./signing";

export interface PendingRestore {
  readonly profile: Profile;
  readonly credential: PinnedCredential;
  readonly sealed: SealedPhrase;
}

export interface RestoreProgress {
  readonly pending: Ref.Ref<Option.Option<PendingRestore>>;
  readonly lock: Semaphore.Semaphore;
}

const zeroed = (prf: Redacted.Redacted<Uint8Array<ArrayBuffer>>) =>
  Effect.sync(() => {
    Redacted.value(prf).fill(0);
  });

export function deviceRestore(
  port: WalletPort,
  passkeys: Passkeys,
  device: SealedDevice,
  progress: RestoreProgress,
) {
  const { pending } = progress;

  const locateBackup = Effect.fn("Device.locateBackup")(function* (
    found: BackupFound,
    credentialId: PinnedCredential["id"],
  ) {
    const onDevice = yield* device.store.readSealed();

    if (
      Option.isSome(onDevice) &&
      onDevice.value.public.address !== found.profile.address
    )
      return new BackupMismatch();

    yield* Ref.set(
      pending,
      Option.some<PendingRestore>({
        profile: found.profile,
        credential: new PinnedCredential({
          id: credentialId,
          publicKey: found.publicKey,
          algorithm: found.algorithm,
        }),
        sealed: found.sealed,
      }),
    );

    return new BackupLocated({ profile: found.profile });
  });

  const requestBackup = Effect.fn("Device.requestBackup")(function* () {
    const challenge = yield* port.restoreChallenge();

    const authenticated = yield* passkeys.authenticate(
      challenge,
      yield* backupSalt,
    );

    if (Option.isNone(authenticated)) return new BackupUnsupported();

    authenticated.value.prf.fill(0);

    const step = yield* port.restore(authenticated.value.assertion);

    return yield* Match.valueTags(step, {
      BackupFound: (found) =>
        locateBackup(found, authenticated.value.assertion.id),
      NoBackup: Effect.succeed,
      AssertionRefused: Effect.succeed,
      ChallengeRefused: Effect.succeed,
    });
  });

  const installCandidate = Effect.fn("Device.installRestoredWallet")(function* (
    profile: Profile,
    candidate: SealedDeviceWallet,
    devicePrf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
  ) {
    const readBack = yield* openLocalEnvelope(
      candidate.envelope,
      {
        network,
        address: profile.address,
        credentialId: candidate.credential.id,
      },
      devicePrf,
    );

    return yield* Match.valueTags(readBack, {
      PhraseOpened: () =>
        device.store
          .installSealed(candidate, "same-address")
          .pipe(
            Effect.map((installed) =>
              installed ? new Restored({ profile }) : new BackupMismatch(),
            ),
          ),
      CorruptEnvelope: () => Effect.succeed(new RestoreUnverified()),
    });
  });

  const sealOpenedPhrase = Effect.fn("Device.sealOpenedPhrase")(function* (
    waiting: PendingRestore,
    backupPrf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
    devicePrf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
    salt: Uint8Array<ArrayBuffer>,
  ) {
    const { profile, credential, sealed } = waiting;
    const phrase = yield* openPhrase(Redacted.value(backupPrf), sealed);

    if (
      Option.isNone(phrase) ||
      phraseAddress(phrase.value) !== profile.address
    )
      return new BackupMismatch();

    const onDevice = yield* device.store.readSealed();

    if (
      Option.isSome(onDevice) &&
      onDevice.value.public.address !== profile.address
    )
      return new BackupMismatch();

    const envelope = yield* sealLocalEnvelope(
      {
        phrase: phrase.value,
        network,
        address: profile.address,
        credentialId: credential.id,
        salt,
      },
      devicePrf,
    );

    return yield* Match.valueTags(envelope, {
      EnvelopeSealed: ({ envelope: sealedEnvelope }) =>
        installCandidate(
          profile,
          new SealedDeviceWallet({
            version: localEnvelopeVersion,
            public: new PublicDeviceWallet({
              address: profile.address,
              username: profile.username,
              backup: "stored",
            }),
            credential,
            envelope: sealedEnvelope,
          }),
          devicePrf,
        ),
      CorruptEnvelope: () => Effect.succeed(new UnsupportedDevice()),
    });
  });

  const sealForDevice = Effect.fn("Device.sealRestoredWallet")(function* (
    waiting: PendingRestore,
  ) {
    const { profile, credential } = waiting;
    const salt = freshInstallationSalt();

    const verified = yield* verifyPinnedAssertion(
      device.ceremony,
      device.relyingParty(),
      credential,
      AssertionIntent.Operation({
        purpose: "restore",
        prf: {
          first: yield* backupSalt,
          second: Option.some(
            yield* localPhrasePrfInput({
              network,
              address: profile.address,
              salt,
            }),
          ),
        },
      }),
    );

    return yield* Match.valueTags(verified, {
      OperationVerified: ({ prf }) =>
        Option.match(prf.second, {
          onNone: () =>
            zeroed(prf.first).pipe(Effect.as(new BackupUnsupported())),
          onSome: (devicePrf) =>
            sealOpenedPhrase(waiting, prf.first, devicePrf, salt).pipe(
              Effect.ensuring(
                Effect.all([zeroed(prf.first), zeroed(devicePrf)]),
              ),
            ),
        }),
      EntryVerified: () => Effect.succeed(new AssertionRefused()),
      WrongCredential: () => Effect.succeed(new AssertionRefused()),
      AssertionRejected: () => Effect.succeed(new AssertionRefused()),
      PrfOutputMissing: () => Effect.succeed(new BackupUnsupported()),
    });
  });

  const restore = Effect.fn("Device.restore")(function* () {
    const waiting = yield* Ref.getAndSet(pending, Option.none());

    const advance: Effect.Effect<
      RestoreOutcome,
      | KeyStoreUnavailable
      | CorruptDeviceWallet
      | WalletUnavailable
      | PasskeyCancelled
      | PasskeyFailed
    > = Option.isNone(waiting) ? requestBackup() : sealForDevice(waiting.value);

    return yield* advance.pipe(
      Effect.tapErrorTag("PasskeyCancelled", () => Ref.set(pending, waiting)),
    );
  });

  return { restore };
}
