import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { AccountAddress, UnclaimedFundsId, CredentialId } from "../contract";
import { canonicalTuple, sha256 } from "./canonical-digest";
import { LinkCode, linkAddressOf } from "./link-code";
import { aesGcmTagLength, envelopeIvLength } from "./local-envelope";

export const linkSealVersion = 2;

const linkSealDomain = "orchid-payment-link-code-v2";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class SealedLinkCode extends Schema.Class<SealedLinkCode>(
  "@workspace/wallet/SealedLinkCode",
)({
  version: Schema.Literal(linkSealVersion),
  network: Schema.NonEmptyString,
  wallet: AccountAddress,
  address: AccountAddress,
  credentialId: CredentialId,
  iv: Schema.Uint8ArrayFromBase64,
  ciphertext: Schema.Uint8ArrayFromBase64,
  unclaimedFunds: Schema.optional(UnclaimedFundsId),
}) {}

export class LinkCodeOpened extends Data.TaggedClass("LinkCodeOpened")<{
  readonly code: Redacted.Redacted<LinkCode>;
}> {}

export class SavedLinkCorrupt extends Schema.TaggedClass<SavedLinkCorrupt>()(
  "SavedLinkCorrupt",
  {},
) {}

export interface LinkPrfContext {
  readonly network: string;
  readonly wallet: AccountAddress;
  readonly address: AccountAddress;
}

export interface LinkSealContext extends LinkPrfContext {
  readonly credentialId: CredentialId;
}

const linkTuple = (context: LinkPrfContext) =>
  canonicalTuple([
    encoder.encode(linkSealDomain),
    encoder.encode(context.network),
    encoder.encode(context.wallet),
    encoder.encode(context.address),
  ]);

export const linkPrfInput = (
  context: LinkPrfContext,
): Effect.Effect<Uint8Array<ArrayBuffer>> => sha256(linkTuple(context));

const linkKey = (
  prf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
  usage: "encrypt" | "decrypt",
) =>
  Effect.tryPromise(async () => {
    const rawPrf = Uint8Array.from(Redacted.value(prf));

    try {
      return await crypto.subtle.deriveKey(
        {
          name: "HKDF",
          hash: "SHA-256",
          salt: new Uint8Array(),
          info: encoder.encode(linkSealDomain),
        },
        await crypto.subtle.importKey("raw", rawPrf, "HKDF", false, [
          "deriveKey",
        ]),
        { name: "AES-GCM", length: 256 },
        false,
        [usage],
      );
    } finally {
      rawPrf.fill(0);
    }
  }).pipe(Effect.option);

export const sealLinkCode = Effect.fn("Device.sealLinkCode")(function* (
  context: LinkSealContext,
  code: LinkCode,
  prf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
): Effect.fn.Return<Option.Option<SealedLinkCode>> {
  if (
    context.network.length === 0 ||
    Redacted.value(prf).byteLength === 0 ||
    !Option.contains(linkAddressOf(code), context.address)
  )
    return Option.none();

  const key = yield* linkKey(prf, "encrypt");

  if (Option.isNone(key)) return Option.none();

  const iv = crypto.getRandomValues(new Uint8Array(envelopeIvLength));

  const ciphertext = yield* Effect.tryPromise(async () => {
    const plaintext = encoder.encode(code);

    try {
      return new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: linkTuple(context) },
          key.value,
          plaintext,
        ),
      );
    } finally {
      plaintext.fill(0);
    }
  }).pipe(Effect.option);

  return Option.map(
    ciphertext,
    (sealed) =>
      new SealedLinkCode({
        version: linkSealVersion,
        network: context.network,
        wallet: context.wallet,
        address: context.address,
        credentialId: context.credentialId,
        iv,
        ciphertext: sealed,
      }),
  );
});

export const matchesLinkContext = (
  sealed: SealedLinkCode,
  expected: LinkSealContext,
) =>
  sealed.network === expected.network &&
  sealed.wallet === expected.wallet &&
  sealed.address === expected.address &&
  sealed.credentialId === expected.credentialId &&
  sealed.iv.byteLength === envelopeIvLength &&
  sealed.ciphertext.byteLength > aesGcmTagLength;

export const openLinkCode = Effect.fn("Device.openLinkCode")(function* (
  sealed: SealedLinkCode,
  expected: LinkSealContext,
  prf: Redacted.Redacted<Uint8Array<ArrayBuffer>>,
): Effect.fn.Return<LinkCodeOpened | SavedLinkCorrupt> {
  if (
    !matchesLinkContext(sealed, expected) ||
    Redacted.value(prf).byteLength === 0
  )
    return new SavedLinkCorrupt();

  const key = yield* linkKey(prf, "decrypt");

  if (Option.isNone(key)) return new SavedLinkCorrupt();

  const text = yield* Effect.tryPromise(async () => {
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: Uint8Array.from(sealed.iv),
          additionalData: linkTuple(expected),
        },
        key.value,
        Uint8Array.from(sealed.ciphertext),
      ),
    );

    try {
      return decoder.decode(plaintext);
    } finally {
      plaintext.fill(0);
    }
  }).pipe(Effect.option);

  const code = Option.flatMap(text, Schema.decodeUnknownOption(LinkCode));

  if (
    Option.isNone(code) ||
    !Option.contains(linkAddressOf(code.value), expected.address)
  )
    return new SavedLinkCorrupt();

  return new LinkCodeOpened({ code: Redacted.make(code.value) });
});
