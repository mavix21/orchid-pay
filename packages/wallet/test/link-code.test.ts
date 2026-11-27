import { expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { LinkCode, linkAddressOf } from "../src/device/link-code";

const issued = "Bcru1zp9FViPqN8CJTvQuS2zg";

const decodeCode = Schema.decodeUnknownOption(LinkCode);

it("derives the same link account from an issued code", () => {
  expect(Option.flatMap(decodeCode(issued), linkAddressOf)).toEqual(
    Option.some("GBSGJFXVVJ4HPVNWP2EJAC6YKXJCJUAO7OYANKGEYNJKKYNXSGJCXLED"),
  );
});

it.each([
  { name: "a code missing its last character", text: issued.slice(0, -1) },
  { name: "a code missing its first character", text: issued.slice(1) },
  {
    name: "a code with one mistyped character",
    text: `${issued.slice(0, 9)}G${issued.slice(10)}`,
  },
  {
    name: "a code with its case changed",
    text: `${issued.slice(0, 3)}U${issued.slice(4)}`,
  },
  { name: "a code with an extra character", text: `${issued}z` },
  { name: "characters outside base58", text: `${issued.slice(0, -1)}0` },
  {
    name: "a Stellar secret key",
    text: "SBQWY3DNPFWGSZTFNV4WQZLBOJ2GQYLTMJSXEZLMOJSXKZTOMVZGK3TBNJSXI",
  },
  { name: "an empty fragment", text: "" },
])("refuses $name", ({ text }) => {
  expect(decodeCode(text)).toEqual(Option.none());
});
