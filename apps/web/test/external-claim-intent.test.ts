import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { expect, it } from "vitest";

import { externalClaimIntentOf } from "../src/links/external-claim-intent";

const destination = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";

it.each([
  ["digits stay MEMO_TEXT unchanged", "001234", "001234"],
  [
    "edge whitespace trimmed and inner spaces kept",
    "  00 12 34 \n",
    "00 12 34",
  ],
  ["exact 28 UTF-8 bytes after trim", `  ${"é".repeat(14)} `, "é".repeat(14)],
])("external claim memo %s", (_name, memo, sent) => {
  expect(
    Option.map(
      Result.getSuccess(externalClaimIntentOf({ destination, memo })),
      (intent) => intent.memo,
    ),
  ).toEqual(Option.some({ type: "text", value: sent }));
});

it("external claim omits a memo that is empty after trimming", () => {
  expect(
    Result.getOrThrow(externalClaimIntentOf({ destination, memo: "  \n " }))
      .memo,
  ).toBeUndefined();
});

it.each([
  ["memo over 28 UTF-8 bytes", destination, "é".repeat(15), "memo"],
  [
    "Solana address with an extra leading zero byte",
    `1${destination}`,
    "",
    "destination",
  ],
  [
    "EVM address",
    "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
    "",
    "destination",
  ],
] as const)(
  "external claim rejects %s on the %s field",
  (_name, target, memo, field) => {
    expect(
      Option.map(
        Result.getFailure(externalClaimIntentOf({ destination: target, memo })),
        (problem) => problem.field,
      ),
    ).toEqual(Option.some(field));
  },
);
