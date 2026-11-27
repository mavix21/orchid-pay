import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  type Approvals,
  type BackupEnrollment,
  type PasskeyRegistration,
  type Username,
  WalletClaim,
} from "../contract";
import { PinnedCredential } from "./assertion";
import {
  EnrollmentPending,
  type HeldReceive,
  type PendingCandidate,
  type PendingEnrollmentRecord,
  type PendingEnrollmentStorage,
} from "./enrollment-records";
import { PublicDeviceWallet, type SealedDeviceWallet } from "./key-store";
import { LocalPhraseEnvelope } from "./local-envelope";
import { standingNow } from "./opening-drafts";
import type { LinkReceiveReview, OpeningReview } from "./outcomes";
import type { SecretPhrase } from "./secret-phrase";

export class Verified extends Data.TaggedClass("Verified")<{
  readonly enrollment: BackupEnrollment;
  readonly candidate: PendingCandidate;
  readonly phrase: SecretPhrase;
}> {}

export type PendingState = Data.TaggedEnum<{
  Idle: {};
  Created: {
    readonly username: Username;
    readonly address: AccountAddress;
    readonly phrase: Redacted.Redacted<SecretPhrase>;
    readonly salt: Uint8Array<ArrayBuffer>;
    readonly registration: PasskeyRegistration;
    readonly credential: PinnedCredential;
    readonly review: Option.Option<OpeningReview>;
  };
  Sealed: {
    readonly enrollment: BackupEnrollment;
    readonly candidate: PendingCandidate;
    readonly review: Option.Option<OpeningReview>;
  };
  Held: {
    readonly enrollment: BackupEnrollment;
    readonly candidate: PendingCandidate;
    readonly review: Option.Option<OpeningReview>;
    readonly approvals: Approvals;
    readonly receive: HeldReceive | undefined;
  };
}>;

export const PendingState = Data.taggedEnum<PendingState>();

export const isCreated = PendingState.$is("Created");

export const isHeld = PendingState.$is("Held");

export type Created = Extract<PendingState, { readonly _tag: "Created" }>;

export type Sealed = Extract<PendingState, { readonly _tag: "Sealed" }>;

export type Awaiting = Created | Sealed;

export type Held = Extract<PendingState, { readonly _tag: "Held" }>;

export const memoryPendingStorage = (): PendingEnrollmentStorage => {
  let saved = Option.none<PendingEnrollmentRecord>();

  return {
    read: () => Effect.sync(() => saved),
    write: (record) =>
      Effect.sync(() => {
        saved = Option.some(record);
      }),
    clear: () =>
      Effect.sync(() => {
        saved = Option.none();
      }),
  };
};

export const pinnedAlgorithm = (
  algorithm: number,
): Option.Option<PinnedCredential["algorithm"]> =>
  algorithm === -7
    ? Option.some("ES256")
    : algorithm === -257
      ? Option.some("RS256")
      : Option.none();

export const pinCredential = (
  registration: PasskeyRegistration,
): Option.Option<PinnedCredential> =>
  pinnedAlgorithm(registration.publicKeyAlgorithm).pipe(
    Option.map(
      (algorithm) =>
        new PinnedCredential({
          id: registration.id,
          publicKey: registration.publicKey,
          algorithm,
        }),
    ),
  );

export const envelopeJson = Schema.encodeSync(
  Schema.fromJsonString(LocalPhraseEnvelope),
);

export const sameCredential = (
  left: PinnedCredential,
  right: PinnedCredential,
) =>
  left.id === right.id &&
  left.publicKey === right.publicKey &&
  left.algorithm === right.algorithm;

export const sameCandidate = (
  installed: SealedDeviceWallet,
  candidate: PendingCandidate,
) =>
  installed.public.address === candidate.address &&
  sameCredential(installed.credential, candidate.credential) &&
  envelopeJson(installed.envelope) === envelopeJson(candidate.envelope);

export const usernameOf = (state: Awaiting | Held) =>
  isCreated(state) ? state.username : state.candidate.username;

export const addressOf = (state: Awaiting | Held) =>
  isCreated(state) ? state.address : state.candidate.address;

export const credentialOf = (state: Awaiting | Held) =>
  isCreated(state) ? state.credential : state.candidate.credential;

export const saltOf = (state: Awaiting) =>
  isCreated(state) ? state.salt : state.candidate.envelope.salt;

export const claimOf = (state: Awaiting | Held) =>
  new WalletClaim({
    username: usernameOf(state),
    address: addressOf(state),
  });

export const withReview = (
  state: Awaiting,
  review: Option.Option<OpeningReview>,
): Awaiting => ({ ...state, review });

export const standingOfReview = (
  state: Awaiting | Held,
  review: OpeningReview,
) =>
  standingNow(
    new PublicDeviceWallet({
      address: addressOf(state),
      username: usernameOf(state),
    }),
    review,
  );

export const notice = (
  state: Awaiting | Held,
  receive: Option.Option<LinkReceiveReview> = Option.none(),
): EnrollmentPending =>
  isHeld(state)
    ? new EnrollmentPending({
        stage: "release",
        username: usernameOf(state),
      })
    : new EnrollmentPending({
        stage: "activate",
        username: usernameOf(state),
        review: Option.getOrUndefined(state.review),
        receive: Option.getOrUndefined(receive),
      });

export const zeroed = (prf: Redacted.Redacted<Uint8Array<ArrayBuffer>>) =>
  Effect.sync(() => {
    Redacted.value(prf).fill(0);
  });
