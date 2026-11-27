import * as Schema from "effect/Schema";
import { AccountAddress, Profile, Username } from "./identity";

export const PasskeyChallenge = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/u),
).pipe(Schema.brand("PasskeyChallenge"));

export type PasskeyChallenge = typeof PasskeyChallenge.Type;

export const ChallengePurpose = Schema.Literals([
  "enrollment",
  "restore",
  "session",
]);

export type ChallengePurpose = typeof ChallengePurpose.Type;

export const Base64Url = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]+$/u),
);

export const CredentialId = Base64Url.pipe(Schema.brand("CredentialId"));

export type CredentialId = typeof CredentialId.Type;

export const PasskeyTransport = Schema.Literals([
  "usb",
  "nfc",
  "ble",
  "hybrid",
  "internal",
  "smart-card",
]);

export class PasskeyRegistration extends Schema.Class<PasskeyRegistration>(
  "@workspace/wallet/PasskeyRegistration",
)({
  id: CredentialId,
  clientDataJSON: Base64Url,
  authenticatorData: Base64Url,
  attestationObject: Base64Url,
  publicKey: Base64Url,
  publicKeyAlgorithm: Schema.Int,
  transports: Schema.Array(PasskeyTransport),
}) {}

export class PasskeyAssertion extends Schema.Class<PasskeyAssertion>(
  "@workspace/wallet/PasskeyAssertion",
)({
  id: CredentialId,
  clientDataJSON: Base64Url,
  authenticatorData: Base64Url,
  signature: Base64Url,
}) {}

export class SealedPhrase extends Schema.Class<SealedPhrase>(
  "@workspace/wallet/SealedPhrase",
)({
  iv: Schema.Uint8ArrayFromBase64,
  ciphertext: Schema.Uint8ArrayFromBase64,
}) {}

export class BackupEnrollment extends Schema.Class<BackupEnrollment>(
  "@workspace/wallet/BackupEnrollment",
)({
  address: AccountAddress,
  username: Username,
  registration: PasskeyRegistration,
  sealed: SealedPhrase,
}) {}

export class BackupStored extends Schema.TaggedClass<BackupStored>()(
  "BackupStored",
  {},
) {}

export class ChallengeIssued extends Schema.TaggedClass<ChallengeIssued>()(
  "ChallengeIssued",
  {
    challenge: PasskeyChallenge,
  },
) {}

export class ChallengeRefused extends Schema.TaggedClass<ChallengeRefused>()(
  "ChallengeRefused",
  {},
) {}

export class RegistrationRefused extends Schema.TaggedClass<RegistrationRefused>()(
  "RegistrationRefused",
  {},
) {}

export class BackupFound extends Schema.TaggedClass<BackupFound>()(
  "BackupFound",
  {
    profile: Profile,
    sealed: SealedPhrase,
    publicKey: Base64Url,
    algorithm: Schema.Literals(["ES256", "RS256"]),
  },
) {}

export class AssertionRefused extends Schema.TaggedClass<AssertionRefused>()(
  "AssertionRefused",
  {},
) {}

export class NoBackup extends Schema.TaggedClass<NoBackup>()("NoBackup", {}) {}

export const RestoreStep = Schema.Union([
  BackupFound,
  NoBackup,
  AssertionRefused,
  ChallengeRefused,
]);

export type RestoreStep = typeof RestoreStep.Type;

export class SessionBegun extends Schema.TaggedClass<SessionBegun>()(
  "SessionBegun",
  {},
) {}

export const SessionStep = Schema.Union([
  SessionBegun,
  NoBackup,
  AssertionRefused,
  ChallengeRefused,
]);

export type SessionStep = typeof SessionStep.Type;
