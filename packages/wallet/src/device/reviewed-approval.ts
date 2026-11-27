import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import type { Approval, SigningRequest } from "../contract";
import { network } from "../device-network";
import {
  AssertionIntent,
  AssertionRejected,
  OperationVerified,
  PinnedCredential,
  type PrfOutputMissing,
  type WrongCredential,
  verifyPinnedAssertion,
} from "./assertion";
import {
  CorruptDeviceWallet,
  type KeyStoreUnavailable,
  type PublicDeviceWallet,
  type SealedDeviceWallet,
  type SealedDevice,
} from "./key-store";
import {
  LocalPhraseEnvelope,
  PhraseOpened,
  localPhrasePrfInput,
  openLocalEnvelope,
} from "./local-envelope";
import { DraftRejected, NoWallet } from "./outcomes";
import type { PasskeyCancelled, PasskeyFailed } from "./passkeys";
import { approveWithPhrase } from "./signing";

export class Reserved<R> extends Data.TaggedClass("Reserved")<{
  readonly reservation: R;
}> {}

class Signed<R> extends Data.TaggedClass("Signed")<{
  readonly approvals: Arr.NonEmptyReadonlyArray<Approval>;
  readonly reservation: R;
}> {}

export interface ReviewedOperation<R, W, A, ReserveError, ReleaseError> {
  readonly record: SealedDeviceWallet;
  readonly requests: Arr.NonEmptyReadonlyArray<SigningRequest>;
  readonly operationInput?: Uint8Array<ArrayBuffer>;
  readonly sign?: (
    requests: Arr.NonEmptyReadonlyArray<SigningRequest>,
  ) => Arr.NonEmptyReadonlyArray<Approval>;
  readonly holds: (
    wallet: PublicDeviceWallet,
    request: SigningRequest,
  ) => Effect.Effect<boolean>;
  readonly reserve: (
    wallet: PublicDeviceWallet,
    operationOutput: Option.Option<Redacted.Redacted<Uint8Array<ArrayBuffer>>>,
  ) => Effect.Effect<Reserved<R> | W, ReserveError>;
  readonly unreserve: (reservation: R) => Effect.Effect<void, ReserveError>;
  readonly release: (
    approvals: Arr.NonEmptyReadonlyArray<Approval>,
    reservation: R,
  ) => Effect.Effect<A, ReleaseError>;
}

export type ApprovalWithheld =
  | NoWallet
  | DraftRejected
  | PasskeyCancelled
  | PasskeyFailed
  | WrongCredential
  | AssertionRejected
  | PrfOutputMissing
  | CorruptDeviceWallet;

const sealJson = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      credential: PinnedCredential,
      envelope: LocalPhraseEnvelope,
    }),
  ),
);

const sameSeal = (left: SealedDeviceWallet, right: SealedDeviceWallet) =>
  left.public.address === right.public.address &&
  sealJson({ credential: left.credential, envelope: left.envelope }) ===
    sealJson({ credential: right.credential, envelope: right.envelope });

export const approveReviewed = <R, W, A, ReserveError, ReleaseError>(
  device: SealedDevice,
  operation: ReviewedOperation<R, W, A, ReserveError, ReleaseError>,
): Effect.Effect<
  A | W | ApprovalWithheld,
  ReserveError | ReleaseError | KeyStoreUnavailable | CorruptDeviceWallet
> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* (): Effect.fn.Return<
      A | W | ApprovalWithheld,
      ReserveError | ReleaseError | KeyStoreUnavailable | CorruptDeviceWallet
    > {
      const { record, requests } = operation;

      const holdsEvery = (wallet: PublicDeviceWallet) =>
        Effect.forEach(requests, (request) =>
          operation.holds(wallet, request),
        ).pipe(Effect.map(Arr.every(Boolean)));

      if (!(yield* holdsEvery(record.public))) return new DraftRejected();

      const prfInput = yield* localPhrasePrfInput({
        network,
        address: record.public.address,
        salt: record.envelope.salt,
      });

      const verified = yield* restore(
        verifyPinnedAssertion(
          device.ceremony,
          device.relyingParty(),
          record.credential,
          AssertionIntent.Operation({
            purpose: "approval",
            prf: {
              first: prfInput,
              second: Option.fromNullishOr(operation.operationInput),
            },
          }),
        ),
      ).pipe(
        Effect.catchTags({
          PasskeyCancelled: (cancelled) => Effect.succeed(cancelled),
          PasskeyFailed: (failed) => Effect.succeed(failed),
        }),
      );

      if (Predicate.isTagged(verified, "EntryVerified"))
        return new AssertionRejected();

      if (!(verified instanceof OperationVerified)) return verified;

      const prf = verified.prf.first;
      const operationOutput = verified.prf.second;

      const sealedApproval: Effect.Effect<
        Signed<R> | W | ApprovalWithheld,
        ReserveError | KeyStoreUnavailable | CorruptDeviceWallet
      > = Effect.gen(function* () {
        const current = yield* restore(device.store.readSealed());

        if (Option.isNone(current)) return new NoWallet();

        const wallet = current.value.public;

        if (
          !sameSeal(current.value, record) ||
          !(yield* restore(holdsEvery(wallet)))
        )
          return new DraftRejected();

        const reserved = yield* operation.reserve(wallet, operationOutput);

        if (!(reserved instanceof Reserved)) return reserved;

        return yield* Effect.gen(function* () {
          if (!(yield* holdsEvery(wallet))) return new DraftRejected();

          if (operation.sign !== undefined)
            return new Signed({
              approvals: operation.sign(requests),
              reservation: reserved.reservation,
            });

          const opened = yield* openLocalEnvelope(
            current.value.envelope,
            {
              network,
              address: wallet.address,
              credentialId: current.value.credential.id,
            },
            prf,
          );

          if (!(opened instanceof PhraseOpened))
            return new CorruptDeviceWallet();

          return new Signed({
            approvals: approveWithPhrase(
              Redacted.value(opened.phrase),
              requests,
            ),
            reservation: reserved.reservation,
          });
        }).pipe(
          Effect.onExit((exit) =>
            Exit.isSuccess(exit) && exit.value instanceof Signed
              ? Effect.void
              : Effect.ignore(operation.unreserve(reserved.reservation)),
          ),
        );
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            Redacted.value(prf).fill(0);

            if (Option.isSome(operationOutput))
              Redacted.value(operationOutput.value).fill(0);
          }),
        ),
      );

      const signed = yield* sealedApproval;

      if (!(signed instanceof Signed)) return signed;

      let releasing = false;

      return yield* restore(
        Effect.suspend(() => {
          releasing = true;

          return operation.release(signed.approvals, signed.reservation);
        }),
      ).pipe(
        Effect.onExit(() =>
          releasing
            ? Effect.void
            : Effect.ignore(operation.unreserve(signed.reservation)),
        ),
      );
    }),
  );
