import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  Approval,
  Approvals,
  AssetOrder,
  AssetStep,
  BackupEnrollment,
  type ChallengeRefused,
  type HumanCheckRefused,
  type OpeningPending,
  Profile,
  type RegistrationRefused,
  Username,
  type UsernameTaken,
  type WalletPort,
  type WalletUnavailable,
} from "../contract";
import { type LinkCode } from "./link-code";
import {
  type AssertionCeremony,
  type AssertionRejected,
  PinnedCredential,
  type RelyingParty,
  type WrongCredential,
} from "./assertion";
import type {
  CorruptDeviceWallet,
  KeyStoreUnavailable,
  SealedKeyStore,
} from "./key-store";
import { type CorruptEnvelope, LocalPhraseEnvelope } from "./local-envelope";
import type {
  BackupUnsupported,
  DraftRejected,
  InvalidUsername,
  LinkCodeMismatch,
  NoWallet,
  ReviewLinkReceiveOutcome,
  UnsupportedDevice,
  WalletOnDevice,
} from "./outcomes";
import { LinkReceiveReview, OpeningReview } from "./outcomes";
import type {
  PasskeyCancelled,
  PasskeyFailed,
  RegistrationCeremony,
} from "./passkeys";

export const EnrollmentStage = Schema.Literals(["activate", "release"]);

export type EnrollmentStage = typeof EnrollmentStage.Type;

export class EnrollmentPending extends Schema.TaggedClass<EnrollmentPending>()(
  "EnrollmentPending",
  {
    stage: EnrollmentStage,
    username: Username,
    review: Schema.optional(OpeningReview),
    receive: Schema.optional(LinkReceiveReview),
  },
) {}

export class WalletEnrolled extends Schema.TaggedClass<WalletEnrolled>()(
  "WalletEnrolled",
  {
    profile: Profile,
    received: Schema.optional(AssetStep),
    receivedLink: Schema.optional(AccountAddress),
  },
) {}

export class HeldReceive extends Schema.Class<HeldReceive>(
  "@workspace/wallet/HeldReceive",
)({
  order: AssetOrder,
  approval: Approval,
}) {}

export interface EnrollmentReceive {
  readonly review: LinkReceiveReview;
  readonly code: LinkCode;
}

export class PendingCandidate extends Schema.Class<PendingCandidate>(
  "@workspace/wallet/PendingCandidate",
)({
  username: Username,
  address: AccountAddress,
  credential: PinnedCredential,
  envelope: LocalPhraseEnvelope,
}) {}

export class PendingActivation extends Schema.TaggedClass<PendingActivation>()(
  "PendingActivation",
  {
    enrollment: BackupEnrollment,
    candidate: PendingCandidate,
    review: Schema.optional(OpeningReview),
  },
) {}

export class PendingRelease extends Schema.TaggedClass<PendingRelease>()(
  "PendingRelease",
  {
    enrollment: BackupEnrollment,
    candidate: PendingCandidate,
    review: Schema.optional(OpeningReview),
    approvals: Approvals,
    receive: Schema.optional(HeldReceive),
  },
) {}

export const PendingEnrollmentRecord = Schema.Union([
  PendingActivation,
  PendingRelease,
]);

export type PendingEnrollmentRecord = typeof PendingEnrollmentRecord.Type;

export interface PendingEnrollmentStorage {
  read(): Effect.Effect<Option.Option<PendingEnrollmentRecord>>;
  write(
    record: PendingEnrollmentRecord,
  ): Effect.Effect<void, KeyStoreUnavailable>;
  clear(): Effect.Effect<void>;
}

export type EnrollWalletOutcome =
  | EnrollmentPending
  | WalletEnrolled
  | OpeningPending
  | NoWallet
  | InvalidUsername
  | UsernameTaken
  | HumanCheckRefused
  | WalletOnDevice
  | BackupUnsupported
  | DraftRejected
  | PasskeyCancelled
  | PasskeyFailed
  | WrongCredential
  | AssertionRejected
  | CorruptEnvelope
  | CorruptDeviceWallet
  | ChallengeRefused
  | RegistrationRefused
  | UnsupportedDevice
  | LinkCodeMismatch
  | WalletUnavailable;

export type ReviewEnrollmentReceiveOutcome =
  | EnrollmentPending
  | UsernameTaken
  | Exclude<ReviewLinkReceiveOutcome, LinkReceiveReview>
  | WalletUnavailable;

export interface EnrollmentDependencies {
  readonly port: Pick<
    WalletPort,
    "enrollmentChallenge" | "enroll" | "open" | "manage" | "paymentLink"
  >;
  readonly store: SealedKeyStore;
  readonly registration: RegistrationCeremony;
  readonly assertions: AssertionCeremony;
  readonly relyingParty: RelyingParty;
  readonly pending?: PendingEnrollmentStorage;
  readonly exclusive?: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>;
}

export interface EnrollmentEffects {
  pending(): Effect.Effect<Option.Option<EnrollmentPending>>;
  start(usernameText: string): Effect.Effect<EnrollWalletOutcome>;
  advance(
    shown?: OpeningReview,
    receive?: EnrollmentReceive,
    committing?: Effect.Effect<void>,
  ): Effect.Effect<EnrollWalletOutcome>;
  reviewReceive(code: LinkCode): Effect.Effect<ReviewEnrollmentReceiveOutcome>;
  discard(): Effect.Effect<boolean>;
}

export interface EnrollmentClient {
  pending(): Promise<Option.Option<EnrollmentPending>>;
  start(usernameText: string): Promise<EnrollWalletOutcome>;
  advance(
    shown?: OpeningReview,
    receive?: EnrollmentReceive,
    onCommitting?: () => void,
  ): Promise<EnrollWalletOutcome>;
  reviewReceive(code: LinkCode): Promise<ReviewEnrollmentReceiveOutcome>;
  discard(): Promise<boolean>;
}
