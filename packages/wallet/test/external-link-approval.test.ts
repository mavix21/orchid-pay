import { expect, it } from "@effect/vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { type Address, address } from "@solana/kit";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  type Approval,
  type DestinationAddress,
  ExternalLinkDraft,
  ExternalLinkSettled,
  PaymentLinkOpen,
  PaymentMemo,
  PositiveAmount,
  SigningRequest,
  type UnclaimedFundsId,
  type UnsignedEnvelope,
  baseAsset,
} from "../src/contract";
import { signingScheme } from "../src/device-network";
import {
  DraftRejected,
  ExternalLinkIntent,
  makeWalletEffects,
} from "../src/device/client";
import { draftLifetime } from "../src/policy";
import { memoryKeyStore, nowSeconds, unusedPort } from "./device-fixtures";
import { SoftwareAuthenticator } from "./software-authenticator";
import { linkFixture, sendActors } from "./solana-device-fixtures";
import { assertTagged } from "./tagged";
import { randomUnclaimedFundsId } from "./test-keys";

const actors = sendActors();
const passkeys = new SoftwareAuthenticator("https://orchid.example").passkeys;
const { code: linkCode, link } = linkFixture();
const linkAmount = Schema.decodeSync(PositiveAmount)("1000000");
const linkBalance = randomUnclaimedFundsId();
const otherBalance = randomUnclaimedFundsId();

const textMemo = Schema.decodeSync(PaymentMemo)({
  type: "text",
  value: "001234",
});

interface ExternalDraft {
  readonly link?: AccountAddress;
  readonly destination?: DestinationAddress;
  readonly unclaimedFunds?: UnclaimedFundsId;
  readonly memo?: PaymentMemo | undefined;
  readonly creditedAccount?: Address;
}

const externalDraft = (overrides: ExternalDraft): UnsignedEnvelope =>
  actors.drafts.linkReceive({
    link,
    destination: actors.stranger,
    unclaimedFunds: linkBalance,
    memo: textMemo,
    ...overrides,
  });

const tamperedExternalDrafts: ReadonlyArray<
  readonly [
    string,
    () => UnsignedEnvelope,
    {
      readonly intentMemo?: PaymentMemo | undefined;
    },
  ]
> = [
  [
    "paying another destination",
    () => externalDraft({ destination: actors.pedro }),
    {},
  ],
  [
    "crediting a token account at the destination address instead of its USDC account",
    () => externalDraft({ creditedAccount: address(actors.stranger) }),
    {},
  ],
  ["dropping the requested memo", () => externalDraft({ memo: undefined }), {}],
  [
    "changing the memo text",
    () =>
      externalDraft({
        memo: Schema.decodeSync(PaymentMemo)({ type: "text", value: "999999" }),
      }),
    {},
  ],
  [
    "signed by another link key",
    () => externalDraft({ link: actors.pedro }),
    {},
  ],
  [
    "claiming other unclaimed funds",
    () => externalDraft({ unclaimedFunds: otherBalance }),
    {},
  ],
];

it.live.each(tamperedExternalDrafts)(
  "external link claim review rejects a draft %s unsigned",
  ([, build, options]) =>
    Effect.gen(function* () {
      const approvals: Array<Option.Option<Approval>> = [];

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
        claimPaymentLink: (_order, approval) =>
          Effect.sync(() => {
            approvals.push(approval);

            const at = nowSeconds();

            return new ExternalLinkDraft({
              request: new SigningRequest({
                envelope: build(),
                expiresAt: DateTime.makeUnsafe((at + draftLifetime) * 1000),
              }),
            });
          }),
      });

      const outcome = yield* makeWalletEffects(
        port,
        memoryKeyStore(),
        passkeys,
      ).reviewExternalLinkClaim(
        linkCode,
        new ExternalLinkIntent({
          destination: actors.stranger,
          memo: "intentMemo" in options ? options.intentMemo : textMemo,
        }),
      );

      expect(outcome).toEqual(new DraftRejected());
      expect(approvals.filter(Option.isSome)).toHaveLength(0);
    }),
);

it.live(
  "external link claim signs with the link key without any wallet on device and keeps the text memo",
  () =>
    Effect.gen(function* () {
      let submitted = Option.none<Approval>();

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
        claimPaymentLink: (order, approval) =>
          Effect.sync(() => {
            if (Option.isSome(approval)) {
              submitted = approval;

              return new ExternalLinkSettled({
                id: order.id,
                settledAt: DateTime.makeUnsafe(Date.now()),
              });
            }

            const at = nowSeconds();

            return new ExternalLinkDraft({
              request: new SigningRequest({
                envelope: externalDraft({
                  destination: order.destination,
                  memo: order.memo,
                }),
                expiresAt: DateTime.makeUnsafe((at + draftLifetime) * 1000),
              }),
            });
          }),
      });

      const effects = makeWalletEffects(port, memoryKeyStore(), passkeys);

      const reviewed = yield* effects.reviewExternalLinkClaim(
        linkCode,
        new ExternalLinkIntent({
          destination: actors.stranger,
          memo: textMemo,
        }),
      );

      assertTagged(reviewed, "ExternalLinkReview");
      expect(reviewed.destination).toBe(actors.stranger);
      expect(reviewed.memo).toEqual(textMemo);

      const settled = yield* effects.confirmExternalLinkClaim(
        reviewed,
        linkCode,
      );

      assertTagged(settled, "ExternalLinkSettled");
      expect(
        ed25519.verify(
          Option.getOrThrow(submitted).signature,
          signingScheme.signingPayload(reviewed.draft.request.envelope),
          base58.decode(link),
        ),
      ).toBe(true);
    }),
);
