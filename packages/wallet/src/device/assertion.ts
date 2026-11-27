import { type AuthenticationJSON, server } from "@passwordless-id/webauthn";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  Base64Url,
  CredentialId,
  type PasskeyAssertion,
  PasskeyChallenge,
} from "../contract";
import type { PasskeyCancelled, PasskeyFailed } from "./passkeys";

export class PinnedCredential extends Schema.Class<PinnedCredential>(
  "@workspace/wallet/PinnedCredential",
)({
  id: CredentialId,
  publicKey: Base64Url,
  algorithm: Schema.Literals(["ES256", "RS256"]),
}) {}

export interface RelyingParty {
  readonly origin: string;
  readonly rpId: string;
}

export const OperationPurpose = Schema.Literals([
  "approval",
  "disclosure",
  "backup",
  "restore",
]);

export type OperationPurpose = typeof OperationPurpose.Type;

export interface PrfInputs {
  readonly first: Uint8Array<ArrayBuffer>;
  readonly second: Option.Option<Uint8Array<ArrayBuffer>>;
}

export type AssertionIntent = Data.TaggedEnum<{
  Entry: {};
  Operation: {
    readonly purpose: OperationPurpose;
    readonly prf: PrfInputs;
  };
}>;

export const AssertionIntent = Data.taggedEnum<AssertionIntent>();

export interface AssertionRequest {
  readonly credentialId: CredentialId;
  readonly challenge: PasskeyChallenge;
  readonly prf: Option.Option<PrfInputs>;
}

export interface PlatformAssertion {
  readonly assertion: PasskeyAssertion;
  readonly prf: {
    readonly first: Option.Option<Uint8Array<ArrayBuffer>>;
    readonly second: Option.Option<Uint8Array<ArrayBuffer>>;
  };
}

export interface AssertionCeremony {
  assert(
    request: AssertionRequest,
  ): Effect.Effect<PlatformAssertion, PasskeyCancelled | PasskeyFailed>;
}

export interface PrfOutputs {
  readonly first: Redacted.Redacted<Uint8Array<ArrayBuffer>>;
  readonly second: Option.Option<Redacted.Redacted<Uint8Array<ArrayBuffer>>>;
}

export class EntryVerified extends Data.TaggedClass("EntryVerified")<{
  readonly assertion: PasskeyAssertion;
}> {}

export class OperationVerified extends Data.TaggedClass("OperationVerified")<{
  readonly purpose: OperationPurpose;
  readonly prf: PrfOutputs;
}> {}

export class WrongCredential extends Schema.TaggedClass<WrongCredential>()(
  "WrongCredential",
  {},
) {}

export class AssertionRejected extends Schema.TaggedClass<AssertionRejected>()(
  "AssertionRejected",
  {},
) {}

export class PrfOutputMissing extends Schema.TaggedClass<PrfOutputMissing>()(
  "PrfOutputMissing",
  {},
) {}

const freshChallenge = () =>
  Schema.decodeSync(PasskeyChallenge)(
    Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(
      crypto.getRandomValues(new Uint8Array(32)),
    ),
  );

const authenticationJson = (
  assertion: PasskeyAssertion,
): AuthenticationJSON => ({
  id: assertion.id,
  rawId: assertion.id,
  type: "public-key",
  clientExtensionResults: {},
  response: {
    clientDataJSON: assertion.clientDataJSON,
    authenticatorData: assertion.authenticatorData,
    signature: assertion.signature,
  },
});

const verifySignedAssertion = (
  credential: PinnedCredential,
  relyingParty: RelyingParty,
  challenge: PasskeyChallenge,
  assertion: PasskeyAssertion,
) =>
  Effect.tryPromise(() =>
    server.verifyAuthentication(
      authenticationJson(assertion),
      {
        id: credential.id,
        publicKey: credential.publicKey,
        algorithm: credential.algorithm,
        transports: [],
      },
      {
        challenge,
        origin: relyingParty.origin,
        domain: relyingParty.rpId,
        userVerified: true,
      },
    ),
  ).pipe(Effect.mapError(() => new AssertionRejected()));

const releasedOutputs = (
  requested: PrfInputs,
  produced: PlatformAssertion["prf"],
): Option.Option<PrfOutputs> => {
  if (Option.isNone(produced.first)) return Option.none();

  return Option.some({
    first: Redacted.make(produced.first.value),
    second: Option.isSome(requested.second)
      ? Option.map(produced.second, Redacted.make)
      : Option.none(),
  });
};

export const verifyPinnedAssertion = Effect.fn("Device.verifyPinnedAssertion")(
  function* (
    ceremony: AssertionCeremony,
    relyingParty: RelyingParty,
    credential: PinnedCredential,
    intent: AssertionIntent,
    challenge: PasskeyChallenge = freshChallenge(),
  ) {
    const platform = yield* ceremony.assert({
      credentialId: credential.id,
      challenge,
      prf: AssertionIntent.$match(intent, {
        Entry: () => Option.none(),
        Operation: ({ prf }) => Option.some(prf),
      }),
    });

    const outcome = Effect.gen(function* () {
      if (platform.assertion.id !== credential.id) return new WrongCredential();

      const verified = yield* verifySignedAssertion(
        credential,
        relyingParty,
        challenge,
        platform.assertion,
      ).pipe(Effect.option);

      if (Option.isNone(verified)) return new AssertionRejected();

      return AssertionIntent.$match(intent, {
        Entry: () => new EntryVerified({ assertion: platform.assertion }),
        Operation: ({ purpose, prf }) =>
          Option.match(releasedOutputs(prf, platform.prf), {
            onNone: () => new PrfOutputMissing(),
            onSome: (outputs) =>
              new OperationVerified({ purpose, prf: outputs }),
          }),
      });
    });

    return yield* outcome.pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          const handedOver =
            Exit.isSuccess(exit) && exit.value instanceof OperationVerified
              ? [
                  Redacted.value(exit.value.prf.first),
                  ...Option.toArray(
                    Option.map(exit.value.prf.second, Redacted.value),
                  ),
                ]
              : [];

          for (const output of [platform.prf.first, platform.prf.second])
            if (Option.isSome(output) && !handedOver.includes(output.value))
              output.value.fill(0);
        }),
      ),
    );
  },
);
