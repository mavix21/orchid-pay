import { baseAsset } from "@workspace/wallet";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { expect, it } from "vitest";

import { intentOf } from "../src/send/intent";

const destination = "GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB";

const intentFor = (memo: string, recipient = destination) =>
  intentOf({ recipient, amount: "1", memo }, "address", baseAsset);

it.each([
  ["001234", "001234"],
  [`  ${"é".repeat(14)} `, "é".repeat(14)],
])("the memo %j is sent as MEMO_TEXT %j", (typed, sent) => {
  expect(
    Option.map(Result.getSuccess(intentFor(typed)), (intent) => intent.memo),
  ).toEqual(Option.some({ type: "text", value: sent }));
});

it("a memo empty after trimming is not sent", () => {
  expect(Result.getOrThrow(intentFor("  ")).memo).toBeUndefined();
});

it("an address from another network is refused on the recipient field", () => {
  expect(
    Option.map(
      Result.getFailure(
        intentFor("", "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"),
      ),
      (problem) => problem.field,
    ),
  ).toEqual(Option.some("recipient"));
});
