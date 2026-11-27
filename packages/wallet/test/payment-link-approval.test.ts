import { expect, it } from "@effect/vitest";
import {
  Account,
  Claimant,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  type Approval,
  AssetCode,
  AssetDraft,
  UnclaimedFundsId,
  LinkRecipient,
  PaymentLinkOpen,
  PositiveAmount,
  SigningRequest,
  type TransferOrder,
  UnsignedEnvelope,
  baseAsset,
  nativeAsset,
} from "../src/contract";
import { issuedAsset } from "../src/stellar/assets";
import {
  DraftRejected,
  PaymentLinkIntent,
  makeWalletEffects,
} from "../src/device/client";
import { unclaimedFundsEntry } from "../src/stellar/ledger-assets.server";
import { recoverablePaymentLinks } from "../src/server/unclaimed-funds.server";
import { draftClaim } from "../src/stellar/asset-envelopes";
import {
  type LinkReceiveInput,
  draftLinkReceive,
} from "../src/stellar/link-receive";
import { baseFee, networkPassphrase, usdc } from "../src/stellar/network";
import {
  memoryKeyStore,
  nowSeconds,
  transferDraftOf,
  unusedPort,
} from "./device-fixtures";
import { SoftwareAuthenticator } from "./software-authenticator";
import { assertTagged } from "./tagged";
import { addressOf } from "./test-keys";
import { linkFixture, sendActors } from "./stellar-device-fixtures";

const actors = sendActors();
const linkAmount = Schema.decodeSync(PositiveAmount)("10000000");
const otherAmount = Schema.decodeSync(PositiveAmount)("20000000");
const passkeys = new SoftwareAuthenticator("http://localhost:3000").passkeys;

const buildTamperedExtraOp = (
  linkAddress: AccountAddress,
  at: number,
): UnsignedEnvelope =>
  Schema.decodeSync(UnsignedEnvelope)(
    new TransactionBuilder(new Account(actors.sender, "100"), {
      fee: baseFee,
      networkPassphrase,
    })
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          source: actors.sponsor,
          sponsoredId: actors.sender,
        }),
      )
      .addOperation(
        Operation.createClaimableBalance({
          asset: usdc,
          amount: "1",
          claimants: [
            new Claimant(linkAddress, Claimant.predicateUnconditional()),
            new Claimant(actors.sender, Claimant.predicateUnconditional()),
          ],
        }),
      )
      .addOperation(Operation.endSponsoringFutureReserves({}))
      .addOperation(
        Operation.payment({
          destination: actors.stranger,
          asset: usdc,
          amount: "1",
        }),
      )
      .setTimebounds(at, at + 120)
      .build()
      .toXDR(),
  );

const linkTarget = (order: TransferOrder) => {
  assertTagged(order.to, "PaymentLink");

  return order.to.value;
};

const tamperedDrafts: ReadonlyArray<
  readonly [
    string,
    (
      order: TransferOrder,
      at: number,
    ) => {
      readonly envelope: UnsignedEnvelope;
      readonly unclaimedFunds?: UnclaimedFundsId;
    },
  ]
> = [
  [
    "different link public key",
    (_order, at) => ({
      envelope: actors.paymentLink({
        to: actors.stranger,
        amount: linkAmount,
        at,
      }),
    }),
  ],
  [
    "different asset",
    (order, at) => ({
      envelope: actors.paymentLink({
        to: linkTarget(order),
        asset: nativeAsset,
        amount: linkAmount,
        at,
      }),
    }),
  ],
  [
    "different amount",
    (order, at) => ({
      envelope: actors.paymentLink({
        to: linkTarget(order),
        amount: otherAmount,
        at,
      }),
    }),
  ],
  [
    "different sponsor",
    (order, at) => ({
      envelope: actors.paymentLink({
        to: linkTarget(order),
        amount: linkAmount,
        reserveSponsor: actors.stranger,
        at,
      }),
    }),
  ],
  [
    "username claimable with delayed sender predicate",
    (order) => ({
      envelope: actors.claimable({
        to: linkTarget(order),
        amount: linkAmount,
      }),
    }),
  ],
  [
    "mismatched unclaimed funds id",
    (order, at) => ({
      envelope: actors.paymentLink({
        to: linkTarget(order),
        amount: linkAmount,
        at,
      }),
      unclaimedFunds: Schema.decodeSync(UnclaimedFundsId)(
        `00000000${"f".repeat(64)}`,
      ),
    }),
  ],
  [
    "extra operation in envelope",
    (order, at) => ({
      envelope: buildTamperedExtraOp(linkTarget(order), at),
    }),
  ],
];

it.live.each(tamperedDrafts)(
  "link funding review rejects payment link with %s unsigned",
  ([, build]) =>
    Effect.gen(function* () {
      const approvals: Array<Option.Option<Approval>> = [];
      const store = memoryKeyStore(Option.some(actors.wallet));

      const port = unusedPort({
        transfer: (order, approval) =>
          Effect.sync(() => {
            approvals.push(approval);

            const at = nowSeconds();
            const built = build(order, at);

            return transferDraftOf(
              built.envelope,
              new LinkRecipient({
                kind: "paymentLink",
                address: linkTarget(order),
              }),
              120,
              at,
              built.unclaimedFunds,
            );
          }),
      });

      const outcome = yield* makeWalletEffects(
        port,
        store,
        passkeys,
      ).reviewPaymentLink(
        new PaymentLinkIntent({
          asset: baseAsset,
          amount: linkAmount,
          saveOnDevice: false,
        }),
      );

      expect(outcome).toEqual(new DraftRejected());
      expect(approvals.filter(Option.isSome)).toHaveLength(0);
    }),
);

it("recovery selects only sponsored unclaimed funds with two unconditional claimants", () => {
  const sender = addressOf(Keypair.random());
  const linkKey = addressOf(Keypair.random());
  const recipient = addressOf(Keypair.random());
  const stranger = addressOf(Keypair.random());

  const linkBalance = Schema.decodeSync(UnclaimedFundsId)(
    `00000000${"1".repeat(64)}`,
  );

  const usernameBalance = Schema.decodeSync(UnclaimedFundsId)(
    `00000000${"2".repeat(64)}`,
  );

  const strangerBalance = Schema.decodeSync(UnclaimedFundsId)(
    `00000000${"3".repeat(64)}`,
  );

  const selected = recoverablePaymentLinks(
    [
      {
        unclaimedFunds: linkBalance,
        asset: baseAsset,
        amount: linkAmount,
        sponsored: true,
        claimants: [
          new Claimant(linkKey, Claimant.predicateUnconditional()),
          new Claimant(sender, Claimant.predicateUnconditional()),
        ],
      },
      {
        unclaimedFunds: usernameBalance,
        asset: baseAsset,
        amount: linkAmount,
        sponsored: true,
        claimants: [
          new Claimant(recipient, Claimant.predicateUnconditional()),
          new Claimant(
            sender,
            Claimant.predicateNot(Claimant.predicateBeforeAbsoluteTime("9999")),
          ),
        ],
      },
      {
        unclaimedFunds: strangerBalance,
        asset: baseAsset,
        amount: linkAmount,
        sponsored: false,
        claimants: [
          new Claimant(stranger, Claimant.predicateUnconditional()),
          new Claimant(sender, Claimant.predicateUnconditional()),
        ],
      },
    ].map(unclaimedFundsEntry),
    sender,
  );

  expect(selected).toEqual([
    {
      unclaimedFunds: linkBalance,
      address: linkKey,
      asset: baseAsset,
      amount: linkAmount,
    },
  ]);
});

const substitutedIssuer = issuedAsset("USDC", actors.stranger);

const substitutedCode = {
  ...baseAsset,
  code: Schema.decodeSync(AssetCode)("EURC"),
};

const cancelBalance = Schema.decodeSync(UnclaimedFundsId)(
  `00000000${"e".repeat(64)}`,
);

const otherBalance = Schema.decodeSync(UnclaimedFundsId)(
  `00000000${"f".repeat(64)}`,
);

it.live.each([
  [
    "substituted issuer on issued link",
    baseAsset,
    substitutedIssuer,
    cancelBalance,
  ],
  [
    "substituted code on issued link",
    substitutedCode,
    baseAsset,
    cancelBalance,
  ],
  ["trustline repair on native link", nativeAsset, baseAsset, cancelBalance],
  ["draft for other unclaimed funds", baseAsset, undefined, otherBalance],
] as const)(
  "reclaim review rejects %s",
  ([, targetAsset, openedAsset, drafted]) =>
    Effect.gen(function* () {
      const approvals: Array<Option.Option<Approval>> = [];
      const store = memoryKeyStore(Option.some(actors.wallet));

      const port = unusedPort({
        manage: (_order, approval) =>
          Effect.sync(() => {
            approvals.push(approval);

            const at = nowSeconds();

            const envelope = draftClaim({
              source: new Account(actors.sender, "100"),
              unclaimedFunds: drafted,
              opens:
                openedAsset === undefined
                  ? undefined
                  : { asset: openedAsset, reserveSponsor: actors.sponsor },
              minTime: at,
              maxTime: at + 120,
            });

            return new AssetDraft({
              request: new SigningRequest({
                envelope,
                expiresAt: DateTime.makeUnsafe((at + 120) * 1000),
              }),
            });
          }),
      });

      const outcome = yield* makeWalletEffects(
        port,
        store,
        passkeys,
      ).reviewReclaim({
        unclaimedFunds: cancelBalance,
        asset: targetAsset,
        amount: linkAmount,
      });

      expect(outcome).toEqual(new DraftRejected());
      expect(approvals.filter(Option.isSome)).toHaveLength(0);
    }),
);

const { code: receivedCode, keypair: receivedLink } = linkFixture();

const receiveDraft = (overrides: Partial<LinkReceiveInput>, at: number) =>
  draftLinkReceive({
    channel: new Account(actors.exchange, "100"),
    link: addressOf(receivedLink),
    reserveSponsor: actors.sponsor,
    createsLinkAccount: true,
    destination: actors.wallet.address,
    unclaimedFunds: cancelBalance,
    asset: baseAsset,
    amount: linkAmount,
    minTime: at,
    maxTime: at + 120,
    ...overrides,
  });

const withExtraPayment = (at: number) => {
  const drafted = TransactionBuilder.fromXDR(
    receiveDraft({}, at),
    networkPassphrase,
  );

  if (!(drafted instanceof Transaction))
    throw new Error("Receive draft must be a transaction");

  return Schema.decodeSync(UnsignedEnvelope)(
    TransactionBuilder.cloneFrom(drafted, { fee: baseFee })
      .addOperation(
        Operation.payment({
          source: addressOf(receivedLink),
          destination: actors.stranger,
          asset: usdc,
          amount: "1",
        }),
      )
      .build()
      .toXDR(),
  );
};

const tamperedReceives: ReadonlyArray<
  readonly [string, (at: number) => UnsignedEnvelope]
> = [
  [
    "paying another destination",
    (at) => receiveDraft({ destination: actors.stranger }, at),
  ],
  [
    "creating another link account",
    (at) => receiveDraft({ link: actors.stranger }, at),
  ],
  [
    "claiming other unclaimed funds",
    (at) => receiveDraft({ unclaimedFunds: otherBalance }, at),
  ],
  ["paying another amount", (at) => receiveDraft({ amount: otherAmount }, at)],
  ["paying another asset", (at) => receiveDraft({ asset: nativeAsset }, at)],
  [
    "handing cleanup to another sponsor",
    (at) => receiveDraft({ reserveSponsor: actors.stranger }, at),
  ],
  [
    "using the link account as channel",
    (at) =>
      receiveDraft(
        { channel: new Account(addressOf(receivedLink), "100") },
        at,
      ),
  ],
  ["with an extra operation", withExtraPayment],
];

it.live.each(tamperedReceives)(
  "link receive review rejects a draft %s unsigned",
  ([, build]) =>
    Effect.gen(function* () {
      const approvals: Array<Option.Option<Approval>> = [];

      const port = unusedPort({
        paymentLink: () =>
          Effect.succeed(
            new PaymentLinkOpen({
              unclaimedFunds: cancelBalance,
              asset: baseAsset,
              amount: linkAmount,
              sender: actors.pedroProfile,
            }),
          ),
        manage: (_order, approval) =>
          Effect.sync(() => {
            approvals.push(approval);

            const at = nowSeconds();

            return new AssetDraft({
              request: new SigningRequest({
                envelope: build(at),
                expiresAt: DateTime.makeUnsafe((at + 120) * 1000),
              }),
            });
          }),
      });

      const outcome = yield* makeWalletEffects(
        port,
        memoryKeyStore(Option.some(actors.wallet)),
        passkeys,
      ).reviewLinkReceive(receivedCode);

      expect(outcome).toEqual(new DraftRejected());
      expect(approvals.filter(Option.isSome)).toHaveLength(0);
    }),
);
