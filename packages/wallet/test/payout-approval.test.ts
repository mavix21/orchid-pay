import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type Approval,
  ExternalLinkDraft,
  ExternalLinkSettled,
  LocalAmount,
  PaymentLinkOpen,
  type PayoutDestination,
  PayoutQuote,
  PeruvianMobile,
  PositiveAmount,
  SigningRequest,
  YapeAccount,
  baseAsset,
} from "../src/contract";
import {
  DraftRejected,
  PayoutReview,
  makeWalletEffects,
} from "../src/device/client";
import { draftLifetime } from "../src/policy";
import { memoryKeyStore, nowSeconds, unusedPort } from "./device-fixtures";
import { SoftwareAuthenticator } from "./software-authenticator";
import { assertTagged } from "./tagged";
import { linkFixture, sendActors } from "./solana-device-fixtures";
import { randomUnclaimedFundsId } from "./test-keys";

const actors = sendActors();
const passkeys = new SoftwareAuthenticator("https://orchid.example").passkeys;
const { code: linkCode, link } = linkFixture();
const linkAmount = Schema.decodeSync(PositiveAmount)("1000000");

const linkBalance = randomUnclaimedFundsId();

const yape = (mobile: string) =>
  YapeAccount.make({ mobile: Schema.decodeSync(PeruvianMobile)(mobile) });

const soles = (minorUnits: bigint) =>
  LocalAmount.make({ currency: "PEN", minorUnits });

const quote = new PayoutQuote({
  link: link,
  unclaimedFunds: linkBalance,
  asset: baseAsset,
  amount: linkAmount,
  local: soles(375n),
  depositAddress: actors.stranger,
});

const alteredReviews: ReadonlyArray<
  readonly [string, (shown: PayoutReview) => PayoutReview]
> = [
  [
    "another Yape number",
    (shown) => new PayoutReview({ ...shown, destination: yape("911222333") }),
  ],
  [
    "other quoted soles",
    (shown) => new PayoutReview({ ...shown, local: soles(9_000n) }),
  ],
];

it.live.each(alteredReviews)(
  "a payout confirm with %s than the issued review is rejected unsigned",
  ([, alter]) =>
    Effect.gen(function* () {
      const approvals: Array<Option.Option<Approval>> = [];
      const destinations: Array<PayoutDestination> = [];

      const port = unusedPort({
        paymentLink: () =>
          Effect.succeed(
            new PaymentLinkOpen({
              unclaimedFunds: linkBalance,
              asset: baseAsset,
              amount: linkAmount,
              sender: actors.pedroProfile,
            }),
          ),
        requestPayout: (order, approval) =>
          Effect.sync(() => {
            approvals.push(approval);
            destinations.push(order.destination);

            if (Option.isSome(approval))
              return new ExternalLinkSettled({
                id: order.claim.id,
                settledAt: DateTime.makeUnsafe(Date.now()),
              });

            const at = nowSeconds();

            return new ExternalLinkDraft({
              request: new SigningRequest({
                envelope: actors.drafts.linkReceive({
                  link,
                  unclaimedFunds: linkBalance,
                  destination: order.claim.destination,
                }),
                expiresAt: DateTime.makeUnsafe((at + draftLifetime) * 1000),
              }),
              memoRequired: false,
            });
          }),
      });

      const effects = makeWalletEffects(port, memoryKeyStore(), passkeys);

      const reviewed = yield* effects.reviewPayout(
        linkCode,
        yape("987654321"),
        quote,
      );

      assertTagged(reviewed, "PayoutReview");

      expect(yield* effects.confirmPayout(alter(reviewed), linkCode)).toEqual(
        new DraftRejected(),
      );
      expect({
        approved: approvals.filter(Option.isSome),
        destinations,
      }).toEqual({ approved: [], destinations: [yape("987654321")] });
    }),
);
