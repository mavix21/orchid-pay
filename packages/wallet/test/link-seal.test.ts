import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { CredentialId } from "../src/contract";
import { generateLinkCode, linkAddressOf } from "../src/device/link-code";
import {
  type LinkSealContext,
  SealedLinkCode,
  linkSealVersion,
  openLinkCode,
  sealLinkCode,
} from "../src/device/link-seal";
import { canonicalTuple } from "../src/device/canonical-digest";
import { network } from "../src/device-network";
import { assertTagged } from "./tagged";
import { randomAddress } from "./test-keys";

const encoder = new TextEncoder();
const code = generateLinkCode();
const otherLink = randomAddress();

const context: LinkSealContext = {
  network,
  wallet: randomAddress(),
  address: Option.getOrThrow(linkAddressOf(code)),
  credentialId: Schema.decodeSync(CredentialId)("Y3JlZGVudGlhbA"),
};

const prfBytes = crypto.getRandomValues(new Uint8Array(32));
const prf = () => Redacted.make(Uint8Array.from(prfBytes));

const sealedText = (plaintext: string) =>
  Effect.promise(async () => {
    const hkdf = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(prfBytes),
      "HKDF",
      false,
      ["deriveKey"],
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: encoder.encode("orchid-payment-link-code-v2"),
      },
      hkdf,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: canonicalTuple(
          [
            "orchid-payment-link-code-v2",
            context.network,
            context.wallet,
            context.address,
          ].map((part) => encoder.encode(part)),
        ),
      },
      key,
      encoder.encode(plaintext),
    );

    return new SealedLinkCode({
      version: linkSealVersion,
      ...context,
      iv,
      ciphertext: new Uint8Array(ciphertext),
    });
  });

const sealed = sealLinkCode(context, code, prf()).pipe(
  Effect.map(Option.getOrThrow),
);

const withBrokenChecksum = `${code.slice(0, -1)}${code.endsWith("A") ? "B" : "A"}`;

it.effect("opens a sealed link code only with its own context and PRF", () =>
  Effect.gen(function* () {
    const opened = yield* openLinkCode(yield* sealed, context, prf());

    assertTagged(opened, "LinkCodeOpened");
    expect(Redacted.value(opened.code)).toBe(code);
  }),
);

it.effect.each([
  {
    name: "another credential's PRF output",
    tampered: sealed,
    output: () => Redacted.make(crypto.getRandomValues(new Uint8Array(32))),
    expected: context,
  },
  {
    name: "a record sealed under another credential",
    tampered: Effect.map(
      sealed,
      (record) =>
        new SealedLinkCode({
          ...record,
          credentialId: Schema.decodeSync(CredentialId)("b3RoZXI"),
        }),
    ),
    output: prf,
    expected: context,
  },
  {
    name: "a record relabelled to another link address",
    tampered: Effect.map(
      sealed,
      (record) => new SealedLinkCode({ ...record, address: otherLink }),
    ),
    output: prf,
    expected: { ...context, address: otherLink },
  },
  {
    name: "a flipped ciphertext byte",
    tampered: Effect.map(sealed, (record) => {
      const ciphertext = Uint8Array.from(record.ciphertext);

      ciphertext[0] = (ciphertext[0] ?? 0) ^ 0xff;

      return new SealedLinkCode({ ...record, ciphertext });
    }),
    output: prf,
    expected: context,
  },
  {
    name: "a code with an invalid checksum",
    tampered: sealedText(withBrokenChecksum),
    output: prf,
    expected: context,
  },
  {
    name: "a code whose key is not the link address",
    tampered: sealedText(generateLinkCode()),
    output: prf,
    expected: context,
  },
])("refuses $name as SavedLinkCorrupt", ({ tampered, output, expected }) =>
  Effect.gen(function* () {
    const opened = yield* openLinkCode(yield* tampered, expected, output());

    expect(opened._tag).toBe("SavedLinkCorrupt");
  }),
);
