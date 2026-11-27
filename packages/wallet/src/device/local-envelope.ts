import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { AccountAddress, CredentialId } from "../contract";
import {
  type AssertionCeremony,
  AssertionIntent,
  AssertionRejected,
  type OperationPurpose,
  type PinnedCredential,
  type PrfOutputMissing,
  type RelyingParty,
  type WrongCredential,
  verifyPinnedAssertion,
} from "./assertion";
import type { PasskeyCancelled, PasskeyFailed } from "./passkeys";
import { canonicalTuple, sha256 } from "./canonical-digest";
import { SecretPhrase } from "./secret-phrase";
import { phraseAddress } from "./signing";

export const localEnvelopeVersion = 2;
export const installationSaltLength = 32;
export const envelopeIvLength = 12;
export const aesGcmTagLength = 16;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class LocalPhraseEnvelope extends Schema.Class<LocalPhraseEnvelope>(
  "@workspace/wallet/LocalPhraseEnvelope",
)({
  version: Schema.Literal(localEnvelopeVersion),
  network: Schema.NonEmptyString,
  address: AccountAddress,
  credentialId: CredentialId,
  salt: Schema.Uint8ArrayFromBase64,
  iv: Schema.Uint8ArrayFromBase64,
  ciphertext: Schema.Uint8ArrayFromBase64,
}) {}

export class EnvelopeSealed extends Data.TaggedClass("EnvelopeSealed")<{
  readonly envelope: LocalPhraseEnvelope;
}> {}

export class PhraseOpened extends Data.TaggedClass("PhraseOpened")<{
  readonly phrase: Redacted.Redacted<SecretPhrase>;
}> {}

export class CorruptEnvelope extends Schema.TaggedClass<CorruptEnvelope>()(
  "CorruptEnvelope",
  {},
) {}

export interface LocalEnvelopeContext {
  readonly network: string;
  readonly address: AccountAddress;
  readonly credentialId: CredentialId;
}

export interface LocalPhrasePrfContext {
  readonly network: string;
  readonly address: AccountAddress;
  readonly salt: Uint8Array;
}

export interface SealLocalEnvelopeInput extends LocalEnvelopeContext {
  readonly phrase: SecretPhrase;
  readonly salt: Uint8Array;
}

export interface ReopenLocalEnvelopeContext {
  readonly network: string;
  readonly address: AccountAddress;
  readonly purpose: OperationPurpose;
}

export type ReopenLocalEnvelopeOutcome =
  | PhraseOpened
  | CorruptEnvelope
  | WrongCredential
  | AssertionRejected
  | PrfOutputMissing;

const versionTag = encoder.encode(`v${localEnvelopeVersion}`);

export const freshInstallationSalt = (): Uint8Array<ArrayBuffer> =>
  crypto.getRandomValues(new Uint8Array(installationSaltLength));

export const localPhrasePrfInput = (
  context: LocalPhrasePrfContext,
): Effect.Effect<Uint8Array<ArrayBuffer>> =>
  sha256(
    canonicalTuple([
      encoder.encode("orchid-prf"),
      encoder.encode("device-phrase"),
      versionTag,
      encoder.encode(context.network),
      encoder.encode(context.address),
      context.salt,
    ]),
  );

const envelopeKeyInfo = (context: LocalEnvelopeContext) =>
  canonicalTuple([
    encoder.encode("orchid-device-phrase-key"),
    versionTag,
    encoder.encode(context.network),
    encoder.encode(context.address),
    encoder.encode(context.credentialId),
  ]);

const envelopeAad = (
  context: LocalEnvelopeContext & { readonly salt: Uint8Array },
) =>
  canonicalTuple([
    encoder.encode("orchid-device-phrase-aad"),
    versionTag,
    encoder.encode(context.network),
    encoder.encode(context.address),
    encoder.encode(context.credentialId),
    context.salt,
  ]);

const deriveEnvelopeKey = (
  prf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
  context: LocalEnvelopeContext & { readonly salt: Uint8Array },
  usage: "encrypt" | "decrypt",
) =>
  Effect.tryPromise(async () => {
    const rawPrf = Uint8Array.from(Redacted.value(prf));

    try {
      const hkdfKey = await crypto.subtle.importKey(
        "raw",
        rawPrf,
        "HKDF",
        false,
        ["deriveKey"],
      );

      return await crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: Uint8Array.from(context.salt),
          info: envelopeKeyInfo(context),
        },
        hkdfKey,
        { name: "AES-GCM", length: 256 },
        false,
        [usage],
      );
    } finally {
      rawPrf.fill(0);
    }
  }).pipe(Effect.option);

export const matchesEnvelopeContext = (
  envelope: LocalPhraseEnvelope,
  expected: LocalEnvelopeContext,
): boolean =>
  expected.network.length > 0 &&
  envelope.version === localEnvelopeVersion &&
  envelope.network === expected.network &&
  envelope.address === expected.address &&
  envelope.credentialId === expected.credentialId &&
  envelope.salt.byteLength === installationSaltLength &&
  envelope.iv.byteLength === envelopeIvLength &&
  envelope.ciphertext.byteLength > aesGcmTagLength;

export const sealLocalEnvelope = Effect.fn("Device.sealLocalEnvelope")(
  function* (
    input: SealLocalEnvelopeInput,
    prf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
  ): Effect.fn.Return<EnvelopeSealed | CorruptEnvelope> {
    if (
      input.network.length === 0 ||
      input.salt.byteLength !== installationSaltLength ||
      Redacted.value(prf).byteLength === 0 ||
      phraseAddress(input.phrase) !== input.address
    )
      return new CorruptEnvelope();

    const salt = Uint8Array.from(input.salt);

    const context = {
      network: input.network,
      address: input.address,
      credentialId: input.credentialId,
      salt,
    };

    const key = yield* deriveEnvelopeKey(prf, context, "encrypt");

    if (Option.isNone(key)) return new CorruptEnvelope();

    const iv = crypto.getRandomValues(new Uint8Array(envelopeIvLength));
    const additionalData = envelopeAad(context);

    const ciphertext = yield* Effect.tryPromise(async () => {
      const plaintext = encoder.encode(input.phrase);

      try {
        return new Uint8Array(
          await crypto.subtle.encrypt(
            { name: "AES-GCM", iv, additionalData },
            key.value,
            plaintext,
          ),
        );
      } finally {
        plaintext.fill(0);
      }
    }).pipe(Effect.option);

    if (Option.isNone(ciphertext)) return new CorruptEnvelope();

    return new EnvelopeSealed({
      envelope: new LocalPhraseEnvelope({
        version: localEnvelopeVersion,
        network: input.network,
        address: input.address,
        credentialId: input.credentialId,
        salt,
        iv,
        ciphertext: ciphertext.value,
      }),
    });
  },
);

export const openLocalEnvelope = Effect.fn("Device.openLocalEnvelope")(
  function* (
    envelope: LocalPhraseEnvelope,
    expected: LocalEnvelopeContext,
    prf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
  ): Effect.fn.Return<PhraseOpened | CorruptEnvelope> {
    if (
      !matchesEnvelopeContext(envelope, expected) ||
      Redacted.value(prf).byteLength === 0
    )
      return new CorruptEnvelope();

    const context = { ...expected, salt: envelope.salt };
    const key = yield* deriveEnvelopeKey(prf, context, "decrypt");

    if (Option.isNone(key)) return new CorruptEnvelope();

    const additionalData = envelopeAad(context);

    const decodedText = yield* Effect.tryPromise(async () => {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: Uint8Array.from(envelope.iv),
          additionalData,
        },
        key.value,
        Uint8Array.from(envelope.ciphertext),
      );

      const plaintext = new Uint8Array(decrypted);

      try {
        return decoder.decode(plaintext);
      } finally {
        plaintext.fill(0);
      }
    }).pipe(Effect.option);

    if (Option.isNone(decodedText)) return new CorruptEnvelope();

    const phrase = Schema.decodeUnknownOption(SecretPhrase)(decodedText.value);

    if (
      Option.isNone(phrase) ||
      phraseAddress(phrase.value) !== expected.address
    )
      return new CorruptEnvelope();

    return new PhraseOpened({ phrase: Redacted.make(phrase.value) });
  },
);

export const reopenLocalEnvelope = Effect.fn("Device.reopenLocalEnvelope")(
  function* (
    ceremony: AssertionCeremony,
    relyingParty: RelyingParty,
    credential: PinnedCredential,
    envelope: LocalPhraseEnvelope,
    expected: ReopenLocalEnvelopeContext,
  ): Effect.fn.Return<
    ReopenLocalEnvelopeOutcome,
    PasskeyCancelled | PasskeyFailed
  > {
    const context: LocalEnvelopeContext = {
      network: expected.network,
      address: expected.address,
      credentialId: credential.id,
    };

    if (!matchesEnvelopeContext(envelope, context))
      return new CorruptEnvelope();

    const prfInput = yield* localPhrasePrfInput({
      network: expected.network,
      address: expected.address,
      salt: envelope.salt,
    });

    const verified = yield* verifyPinnedAssertion(
      ceremony,
      relyingParty,
      credential,
      AssertionIntent.Operation({
        purpose: expected.purpose,
        prf: { first: prfInput, second: Option.none() },
      }),
    );

    return yield* Match.valueTags(verified, {
      OperationVerified: ({ prf }) =>
        openLocalEnvelope(envelope, context, prf.first).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              Redacted.value(prf.first).fill(0);
            }),
          ),
        ),
      EntryVerified: () => Effect.succeed(new AssertionRejected()),
      WrongCredential: Effect.succeed,
      AssertionRejected: Effect.succeed,
      PrfOutputMissing: Effect.succeed,
    });
  },
);
