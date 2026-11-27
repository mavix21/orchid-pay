import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { SigningRequest, UnsignedEnvelope } from "../src/contract";
import { LinkCode } from "../src/device/link-code";
import { approveWithLinkCode, approveWithPhrase } from "../src/device/signing";
import { knownPhrase } from "./device-fixtures";

const request = new SigningRequest({
  envelope: Schema.decodeSync(UnsignedEnvelope)(
    "AAAAAgAAAADjcmgwoLYMtfUshEz/zU7tZeulwVXomyZBFWJyTnHlRAAAAGQAAAAAAAAAZQAAAAEAAAAAa0nSAAAAAABrSdJ4AAAAAAAAAAEAAAAAAAAAAQAAAABkZJb1qnh31bZ+iJAL2FXSJNAO+7AGqMTDUqVht5GSKwAAAAAAAAAAAJiWgAAAAAAAAAAA",
  ),
  expiresAt: DateTime.makeUnsafe(1_800_000_120_000),
});

const linkCode = Schema.decodeSync(LinkCode)("Bcru1zp9FViPqN8CJTvQuS2zg");

it.each([
  {
    name: "a secret phrase",
    approve: () => approveWithPhrase(knownPhrase, [request]),
    signature:
      "jdbYHMdba7EktVlcob9bf86HFfJe7TExWJndHzLXjzMevxJDN22bbM6kYgy4tXgbqfjvql169I+NPu7vGGqJBw==",
  },
  {
    name: "a link key",
    approve: () => approveWithLinkCode(linkCode, [request]),
    signature:
      "FXQhK6jUsvLpd2Wk34fPA87j5jmA1K3UeIUY4OjmGVH7J6jV5L3ACNj1Gsx5/QoH1ptBCEFLuhKo1CHAuwZuDg==",
  },
])("approves a draft with $name byte for byte", ({ approve, signature }) => {
  expect(
    approve().map((approval) =>
      Buffer.from(approval.signature).toString("base64"),
    ),
  ).toEqual([signature]);
});
