import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  CredentialId,
  type PasskeyChallenge,
  PasskeyAssertion,
  PasskeyRegistration,
  PasskeyTransport,
} from "../contract";
import type {
  AssertionCeremony,
  AssertionRequest,
  PrfInputs,
  RelyingParty,
} from "./assertion";
import {
  PasskeyCancelled,
  PasskeyFailed,
  type Passkeys,
  type RegistrationCeremony,
  type RegistrationRequest,
} from "./passkeys";

const toBase64Url = (buffer: ArrayBuffer) =>
  Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(new Uint8Array(buffer));

const base64UrlBytes = (value: string) =>
  Uint8Array.from(Schema.decodeSync(Schema.Uint8ArrayFromBase64Url)(value));

const verifiableAlgorithms: Array<PublicKeyCredentialParameters> = [
  { type: "public-key", alg: -7 },
  { type: "public-key", alg: -257 },
];

const ceremony = (run: () => Promise<Credential | null>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      cause instanceof DOMException &&
      (cause.name === "NotAllowedError" || cause.name === "AbortError")
        ? new PasskeyCancelled()
        : new PasskeyFailed(),
  }).pipe(
    Effect.flatMap((credential) =>
      credential instanceof PublicKeyCredential
        ? Effect.succeed(credential)
        : Effect.fail(new PasskeyFailed()),
    ),
  );

const prfReported = Effect.tryPromise(async () =>
  "getClientCapabilities" in PublicKeyCredential
    ? (await PublicKeyCredential.getClientCapabilities())["extension:prf"] !==
      false
    : true,
).pipe(Effect.orElseSucceed(() => true));

const copiedBytes = (value: BufferSource) =>
  value instanceof ArrayBuffer
    ? Uint8Array.from(new Uint8Array(value))
    : Uint8Array.from(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );

const prfResults = (credential: PublicKeyCredential) => {
  const results = credential.getClientExtensionResults().prf?.results;

  return {
    first: Option.fromNullishOr(results?.first).pipe(Option.map(copiedBytes)),
    second: Option.fromNullishOr(results?.second).pipe(Option.map(copiedBytes)),
  };
};

const prfOutput = (credential: PublicKeyCredential) =>
  prfResults(credential).first;

const prfEvaluation = (inputs: PrfInputs) => ({
  prf: {
    eval: Option.match(inputs.second, {
      onNone: () => ({ first: inputs.first }),
      onSome: (second) => ({ first: inputs.first, second }),
    }),
  },
});

const prfRequest = (salt: Uint8Array<ArrayBuffer>) =>
  prfEvaluation({ first: salt, second: Option.none() });

const webAuthnAvailable = () =>
  "PublicKeyCredential" in globalThis && "credentials" in navigator;

const createRegistration = Effect.fn("Device.createPasskeyRegistration")(
  function* (request: RegistrationRequest) {
    if (!webAuthnAvailable() || !(yield* prfReported)) return Option.none();

    const created = yield* ceremony(() =>
      navigator.credentials.create({
        publicKey: {
          challenge: base64UrlBytes(request.challenge),
          rp: { name: "Orchid", id: location.hostname },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: `@${request.username}`,
            displayName: `@${request.username}`,
          },
          pubKeyCredParams: verifiableAlgorithms,
          authenticatorSelection: {
            residentKey: "required",
            requireResidentKey: true,
            userVerification: "required",
          },
          attestation: "none",
          extensions: { prf: {} },
        },
      }),
    );

    const response = created.response;

    const publicKey =
      response instanceof AuthenticatorAttestationResponse
        ? response.getPublicKey()
        : null;

    if (
      !(response instanceof AuthenticatorAttestationResponse) ||
      publicKey === null
    )
      return yield* Effect.fail(new PasskeyFailed());

    return Option.some(
      new PasskeyRegistration({
        id: Schema.decodeSync(CredentialId)(created.id),
        clientDataJSON: toBase64Url(response.clientDataJSON),
        authenticatorData: toBase64Url(response.getAuthenticatorData()),
        attestationObject: toBase64Url(response.attestationObject),
        publicKey: toBase64Url(publicKey),
        publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
        transports: response
          .getTransports()
          .flatMap((transport) =>
            Option.toArray(
              Schema.decodeUnknownOption(PasskeyTransport)(transport),
            ),
          ),
      }),
    );
  },
);

const authenticate = Effect.fn("Device.authenticatePasskey")(function* (
  challenge: PasskeyChallenge,
  salt: Uint8Array<ArrayBuffer>,
) {
  if (!webAuthnAvailable()) return Option.none();

  const asserted = yield* ceremony(() =>
    navigator.credentials.get({
      publicKey: {
        challenge: base64UrlBytes(challenge),
        rpId: location.hostname,
        userVerification: "required",
        extensions: prfRequest(salt),
      },
    }),
  );

  const response = asserted.response;
  const prf = prfOutput(asserted);

  if (
    !(response instanceof AuthenticatorAssertionResponse) ||
    Option.isNone(prf)
  )
    return Option.none();

  return Option.some({
    prf: prf.value,
    assertion: new PasskeyAssertion({
      id: Schema.decodeSync(CredentialId)(asserted.id),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
    }),
  });
});

const assert = Effect.fn("Device.assertPasskey")(function* (
  request: AssertionRequest,
) {
  if (!webAuthnAvailable()) return yield* Effect.fail(new PasskeyFailed());

  const asserted = yield* ceremony(() =>
    navigator.credentials.get({
      publicKey: {
        challenge: base64UrlBytes(request.challenge),
        rpId: location.hostname,
        allowCredentials: [
          { type: "public-key", id: base64UrlBytes(request.credentialId) },
        ],
        userVerification: "required",
        extensions: Option.getOrUndefined(
          Option.map(request.prf, prfEvaluation),
        ),
      },
    }),
  );

  const response = asserted.response;

  if (!(response instanceof AuthenticatorAssertionResponse))
    return yield* Effect.fail(new PasskeyFailed());

  return {
    prf: prfResults(asserted),
    assertion: new PasskeyAssertion({
      id: Schema.decodeSync(CredentialId)(asserted.id),
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
    }),
  };
});

export const browserPasskeys: Passkeys = { authenticate };

export const browserRegistration: RegistrationCeremony = {
  register: createRegistration,
};

export const browserAssertions: AssertionCeremony = { assert };

export const browserRelyingParty = (): RelyingParty => ({
  origin: location.origin,
  rpId: location.hostname,
});
