import { expect, it } from "@effect/vitest";
import {
  Account,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type Approval,
  UnclaimedFundsId,
  ExternalLinkDraft,
  ExternalLinkSettled,
  MemoNotAllowed,
  PaymentLinkOpen,
  PaymentMemo,
  PositiveAmount,
  SigningRequest,
  UnsignedEnvelope,
  baseAsset,
} from "../src/contract";
import {
  DraftRejected,
  ExternalLinkIntent,
  makeWalletEffects,
} from "../src/device/client";
import { signingPayload } from "../src/stellar/envelopes";
import {
  type LinkReceiveInput,
  draftLinkReceive,
} from "../src/stellar/link-receive";
import { baseFee, networkPassphrase, usdc } from "../src/stellar/network";
import { memoryKeyStore, nowSeconds, unusedPort } from "./device-fixtures";
import { SoftwareAuthenticator } from "./software-authenticator";
import { assertTagged } from "./tagged";
import { addressOf } from "./test-keys";
import { linkFixture, sendActors } from "./stellar-device-fixtures";
import { lumens } from "../src/stellar/assets";

const actors = sendActors();
const passkeys = new SoftwareAuthenticator("https://orchid.example").passkeys;
const { code: linkCode, keypair: link } = linkFixture();
const linkAmount = Schema.decodeSync(PositiveAmount)("10000000");
const otherAmount = Schema.decodeSync(PositiveAmount)("20000000");

const linkBalance = Schema.decodeSync(UnclaimedFundsId)(
  `00000000${"e".repeat(64)}`,
);

const otherBalance = Schema.decodeSync(UnclaimedFundsId)(
  `00000000${"f".repeat(64)}`,
);

const textMemo = Schema.decodeSync(PaymentMemo)({
  type: "text",
  value: "001234",
});

const idMemo = Schema.decodeSync(PaymentMemo)({
  type: "id",
  value: "18446744073709551615",
});

const externalDraft = (overrides: Partial<LinkReceiveInput>, at: number) =>
  draftLinkReceive({
    channel: new Account(actors.exchange, "100"),
    link: addressOf(link),
    reserveSponsor: actors.sponsor,
    createsLinkAccount: true,
    destination: actors.stranger,
    unclaimedFunds: linkBalance,
    asset: baseAsset,
    amount: linkAmount,
    memo: textMemo,
    minTime: at,
    maxTime: at + 120,
    ...overrides,
  });

const withExtraPayment = (at: number) => {
  const drafted = TransactionBuilder.fromXDR(
    externalDraft({}, at),
    networkPassphrase,
  );

  if (!(drafted instanceof Transaction))
    throw new Error("Receive draft must be a transaction");

  return Schema.decodeSync(UnsignedEnvelope)(
    TransactionBuilder.cloneFrom(drafted, { fee: baseFee })
      .addOperation(
        Operation.payment({
          source: addressOf(link),
          destination: actors.pedro,
          asset: usdc,
          amount: "1",
        }),
      )
      .build()
      .toXDR(),
  );
};

const tamperedExternalDrafts: ReadonlyArray<
  readonly [
    string,
    (at: number) => UnsignedEnvelope,
    {
      readonly memoRequired?: boolean;
      readonly intentMemo?: PaymentMemo | undefined;
    },
  ]
> = [
  [
    "paying another destination",
    (at) => externalDraft({ destination: actors.pedro }, at),
    {},
  ],
  [
    "dropping the requested memo",
    (at) => externalDraft({ memo: undefined }, at),
    {},
  ],
  [
    "claiming memoRequired without a memo",
    (at) => externalDraft({ memo: undefined }, at),
    { memoRequired: true, intentMemo: undefined },
  ],
  [
    "coercing a text memo into MEMO_ID",
    (at) =>
      externalDraft(
        { memo: Schema.decodeSync(PaymentMemo)({ type: "id", value: "1234" }) },
        at,
      ),
    {},
  ],
  [
    "changing the memo text",
    (at) =>
      externalDraft(
        {
          memo: Schema.decodeSync(PaymentMemo)({
            type: "text",
            value: "999999",
          }),
        },
        at,
      ),
    {},
  ],
  [
    "creating another link account",
    (at) => externalDraft({ link: actors.pedro }, at),
    {},
  ],
  [
    "claiming other unclaimed funds",
    (at) => externalDraft({ unclaimedFunds: otherBalance }, at),
    {},
  ],
  [
    "paying another amount",
    (at) => externalDraft({ amount: otherAmount }, at),
    {},
  ],
  ["paying another asset", (at) => externalDraft({ asset: lumens }, at), {}],
  [
    "using the link account as channel",
    (at) => externalDraft({ channel: new Account(addressOf(link), "100") }, at),
    {},
  ],
  ["with an extra operation", withExtraPayment, {}],
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
                envelope: build(at),
                expiresAt: DateTime.makeUnsafe((at + 120) * 1000),
              }),
              memoRequired: options.memoRequired ?? false,
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
  "external link claim signs with the link key without any wallet on device and round-trips explicit MEMO_ID",
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
                envelope: externalDraft(
                  { destination: order.destination, memo: order.memo },
                  at,
                ),
                expiresAt: DateTime.makeUnsafe((at + 120) * 1000),
              }),
              memoRequired: true,
            });
          }),
      });

      const effects = makeWalletEffects(port, memoryKeyStore(), passkeys);

      const reviewed = yield* effects.reviewExternalLinkClaim(
        linkCode,
        new ExternalLinkIntent({
          destination: actors.stranger,
          memo: idMemo,
        }),
      );

      assertTagged(reviewed, "ExternalLinkReview");
      expect(reviewed.memo).toEqual(idMemo);
      expect(reviewed.memoRequired).toBe(true);

      const settled = yield* effects.confirmExternalLinkClaim(
        reviewed,
        linkCode,
      );

      assertTagged(settled, "ExternalLinkSettled");
      expect(
        link.verify(
          signingPayload(reviewed.draft.request.envelope),
          Option.getOrThrow(submitted).signature,
        ),
      ).toBe(true);
    }),
);

it.live(
  "external link claim refuses a muxed destination with a memo before contacting the server",
  () =>
    Effect.gen(function* () {
      const outcome = yield* makeWalletEffects(
        unusedPort(),
        memoryKeyStore(),
        passkeys,
      ).reviewExternalLinkClaim(
        linkCode,
        new ExternalLinkIntent({
          destination: actors.muxed("42"),
          memo: textMemo,
        }),
      );

      expect(outcome).toEqual(new MemoNotAllowed({ reason: "muxed" }));
    }),
);
