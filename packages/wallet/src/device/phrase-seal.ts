import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { SealedPhrase } from "../contract";
import { SecretPhrase } from "./secret-phrase";

const encoder = new TextEncoder();

export const backupSalt = Effect.promise(() =>
  crypto.subtle.digest(
    "SHA-256",
    encoder.encode("orchid secret phrase backup v1"),
  ),
).pipe(Effect.map((digest) => new Uint8Array(digest)));

const backupKey = (prf: Uint8Array<ArrayBuffer>) =>
  Effect.promise(async () =>
    crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: encoder.encode("orchid-secret-phrase-backup"),
      },
      await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    ),
  );

export const sealPhrase = Effect.fn("Device.sealPhrase")(function* (
  prf: Uint8Array<ArrayBuffer>,
  phrase: SecretPhrase,
) {
  const key = yield* backupKey(prf);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = yield* Effect.promise(async () => {
    const plaintext = encoder.encode(phrase);

    try {
      return await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        plaintext,
      );
    } finally {
      plaintext.fill(0);
    }
  });

  return new SealedPhrase({ iv, ciphertext: new Uint8Array(ciphertext) });
});

export const openPhrase = Effect.fn("Device.openPhrase")(function* (
  prf: Uint8Array<ArrayBuffer>,
  sealed: SealedPhrase,
) {
  const key = yield* backupKey(prf);

  const plaintext = yield* Effect.tryPromise(() =>
    crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Uint8Array.from(sealed.iv) },
      key,
      Uint8Array.from(sealed.ciphertext),
    ),
  ).pipe(Effect.option);

  return Option.flatMap(plaintext, (bytes) =>
    Schema.decodeUnknownOption(SecretPhrase)(new TextDecoder().decode(bytes)),
  );
});
