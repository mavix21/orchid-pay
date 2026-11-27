import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { SealedPhrase } from "../src/contract";
import { openPhrase, sealPhrase } from "../src/device/phrase-seal";
import { knownPhrase } from "./device-fixtures";

const versionOnePrf = Uint8Array.from(
  Buffer.from(
    "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    "hex",
  ),
);

const versionOneSealed = new SealedPhrase({
  iv: Uint8Array.from(Buffer.from("a0a1a2a3a4a5a6a7a8a9aaab", "hex")),
  ciphertext: Uint8Array.from(
    Buffer.from(
      "iK2Fw8c4dUxnJEs2uBU+uySW4Nd2MXN6Pu4B531/anFMzEL+Sj3l++bCRxWzjLtVDWjqUujE1DrCun3R7Y+RYaIPot5pA3uTnmXp9mPStPfvR3dRttxY3Q==",
      "base64",
    ),
  ),
});

it.effect("opens a phrase sealed with the version 1 backup format", () =>
  Effect.gen(function* () {
    expect(yield* openPhrase(versionOnePrf, versionOneSealed)).toEqual(
      Option.some(knownPhrase),
    );
  }),
);

it.effect("a different passkey output cannot open a sealed phrase", () =>
  Effect.gen(function* () {
    const sealed = yield* sealPhrase(versionOnePrf, knownPhrase);
    const other = new Uint8Array(32).fill(9);

    expect(yield* openPhrase(other, sealed)).toEqual(Option.none());
  }),
);
