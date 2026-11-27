import { Keypair } from "@stellar/stellar-sdk";
import {
  AccountAddress,
  UnclaimedFundsId,
  LinkCode,
  PaymentLinkCreated,
  PositiveAmount,
  TransferId,
  baseAsset,
} from "@workspace/wallet";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";

import { type Delivery, LinkStep, concealedStep } from "../src/links/link-step";

const code = Schema.decodeSync(LinkCode)("Bcru1zp9FViPqN8CJTvQuS2zg");

const unclaimedFunds = Schema.decodeSync(UnclaimedFundsId)(
  `00000000${"ab".repeat(32)}`,
);

const amount = Schema.decodeSync(PositiveAmount)("5000000");

const created = new PaymentLinkCreated({
  id: Schema.decodeSync(TransferId)(crypto.randomUUID()),
  address: Schema.decodeSync(AccountAddress)(Keypair.random().publicKey()),
  code,
  unclaimedFunds,
  asset: baseAsset,
  amount,
  network: "testnet",
  path: `/r#${code}`,
  settledAt: DateTime.makeUnsafe(0),
  savedOnDevice: false,
});

const receipt = { unclaimedFunds, asset: baseAsset, amount };

it.each([
  [
    "Created",
    (delivery: Delivery) => LinkStep.Created({ link: created, delivery }),
  ],
  [
    "Sharing",
    (delivery: Delivery) => LinkStep.Sharing({ link: created, delivery }),
  ],
])("a %s link keeps only its receipt once concealed", (_, step) => {
  expect(concealedStep(step("dismissed"))).toEqual(
    Option.some(LinkStep.Lost({ link: receipt })),
  );
  expect(concealedStep(step("shared"))).toEqual(
    Option.some(LinkStep.Sent({ link: receipt, delivery: "shared" })),
  );
});

it("an unshared link saved on the device keeps its address to re-share, never its secret", () => {
  expect(
    concealedStep(
      LinkStep.Created({
        link: new PaymentLinkCreated({ ...created, savedOnDevice: true }),
        delivery: "dismissed",
      }),
    ),
  ).toEqual(
    Option.some(
      LinkStep.Saved({ link: { ...receipt, address: created.address } }),
    ),
  );
});

it("a step with no link to protect keeps nothing", () => {
  expect(concealedStep(LinkStep.Checking())).toEqual(Option.none());
});
