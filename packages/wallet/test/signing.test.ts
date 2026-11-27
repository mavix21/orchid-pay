import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { SigningRequest, UnsignedEnvelope } from "../src/contract";
import { LinkCode } from "../src/device/link-code";
import { approveWithLinkCode, approveWithPhrase } from "../src/device/signing";
import { knownPhrase } from "./device-fixtures";

const request = new SigningRequest({
  envelope: Schema.decodeSync(UnsignedEnvelope)(
    "ASwBAAAAAAAAyAAAAAAAAACAAgEDB4OEdCkuZ1qUtDbssKmYiUIyioPdxiM4ApYSZ8XNYRfL+Pv2rqPdAHKBLJSsbZpljUpxH8rDJDwI0qoWKpPeJqEVSmxmWlZDhb5qN6HrpG2jL7gZPFfvBrLNB5WRLzSJwUPP8mVBQWg25I3w6C+/HfRvUl5fLKmKECTCRggokeZlO0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqcDBkZv5SEXMv/srbpyw5vnvIzlu8X3EmssQ5s6QAAAAAbd9uHXZaGT2cvhRs7reawctIXtX1s3kTqM9YV+/wCpzEkOkozS44c7s0P8ldozF5ymD02/RsLDbpEpnVXU5rkDBQAFAmDqAAAFAAkD6AMAAAAAAAAGBAIEAwEKDEBCDwAAAAAABgA=",
  ),
  expiresAt: DateTime.makeUnsafe(1_800_000_050_000),
});

const linkCode = Schema.decodeSync(LinkCode)("Bcru1zp9FViPqN8CJTvQuS2zg");

it.each([
  {
    name: "a secret phrase",
    approve: () => approveWithPhrase(knownPhrase, [request]),
    signature:
      "FOFvVsTg0J030/0GwmfC8s55FK9ynlf3oEQHXe9H+6QlrA8i+CjvzxXmkzP+Ss58sOs9xxm0mU5i30murR7fCA==",
  },
  {
    name: "a link key",
    approve: () => approveWithLinkCode(linkCode, [request]),
    signature:
      "qM7nAPGLg7F6LRSLYjGxmAONpkdtIrUJ5/Aa0S0pOZs2CE1gL7cGOGxOUyBNFWE4Jl9k/5oWXj7tqbFnUdzQBw==",
  },
])("approves a draft with $name byte for byte", ({ approve, signature }) => {
  expect(
    approve().map((approval) =>
      Buffer.from(approval.signature).toString("base64"),
    ),
  ).toEqual([signature]);
});
