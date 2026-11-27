import { expect, it } from "@effect/vitest";
import { type Address, address } from "@solana/kit";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  type Approval,
  AssetDraft,
  type DestinationAddress,
  LinkRecipient,
  PaymentLinkOpen,
  PositiveAmount,
  SigningRequest,
  type TransferOrder,
  type UnclaimedFundsId,
  type UnsignedEnvelope,
  baseAsset,
} from "../src/contract";
import {
  DraftRejected,
  PaymentLinkIntent,
  makeWalletEffects,
} from "../src/device/client";
import { draftLifetime } from "../src/policy";
import {
  memoryKeyStore,
  nowSeconds,
  transferDraftOf,
  unusedPort,
} from "./device-fixtures";
import { SoftwareAuthenticator } from "./software-authenticator";
import {
  linkFixture,
  sendActors,
  solanaDrafts,
} from "./solana-device-fixtures";
import { assertTagged } from "./tagged";
import { randomUnclaimedFundsId } from "./test-keys";

const actors = sendActors();
const strangerDrafts = solanaDrafts(actors.stranger);
const linkAmount = Schema.decodeSync(PositiveAmount)("1000000");
const otherAmount = Schema.decodeSync(PositiveAmount)("2000000");
const passkeys = new SoftwareAuthenticator("http://localhost:3000").passkeys;
const cancelBalance = randomUnclaimedFundsId();
const otherBalance = randomUnclaimedFundsId();

const expiringRequest = (envelope: UnsignedEnvelope) =>
  new SigningRequest({
    envelope,
    expiresAt: DateTime.makeUnsafe((nowSeconds() + draftLifetime) * 1000),
  });

const linkTarget = (order: TransferOrder) => {
  assertTagged(order.to, "PaymentLink");

  return order.to.value;
};

const tamperedDrafts: ReadonlyArray<
  readonly [
    string,
    (order: TransferOrder) => {
      readonly envelope: UnsignedEnvelope;
      readonly unclaimedFunds?: UnclaimedFundsId;
    },
  ]
> = [
  [
    "different link public key",
    () => ({
      envelope: actors.paymentLink({ to: actors.stranger, amount: linkAmount }),
    }),
  ],
  [
    "different amount",
    (order) => ({
      envelope: actors.paymentLink({
        to: linkTarget(order),
        amount: otherAmount,
      }),
    }),
  ],
  [
    "rent returned to another sponsor",
    (order) => ({
      envelope: strangerDrafts.paymentLink({
        from: actors.sender,
        to: linkTarget(order),
        amount: linkAmount,
      }),
    }),
  ],
  [
    "mismatched unclaimed funds id",
    (order) => ({
      envelope: actors.paymentLink({
        to: linkTarget(order),
        amount: linkAmount,
      }),
      unclaimedFunds: otherBalance,
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

            const built = build(order);

            return transferDraftOf(
              built.envelope,
              new LinkRecipient({
                kind: "paymentLink",
                address: linkTarget(order),
              }),
              draftLifetime,
              nowSeconds(),
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

it.live("reclaim review rejects a draft for other unclaimed funds", () =>
  Effect.gen(function* () {
    const approvals: Array<Option.Option<Approval>> = [];

    const port = unusedPort({
      manage: (_order, approval) =>
        Effect.sync(() => {
          approvals.push(approval);

          return new AssetDraft({
            request: expiringRequest(
              actors.drafts.reclaim(actors.sender, otherBalance),
            ),
          });
        }),
    });

    const outcome = yield* makeWalletEffects(
      port,
      memoryKeyStore(Option.some(actors.wallet)),
      passkeys,
    ).reviewReclaim({
      unclaimedFunds: cancelBalance,
      asset: baseAsset,
      amount: linkAmount,
    });

    expect(outcome).toEqual(new DraftRejected());
    expect(approvals.filter(Option.isSome)).toHaveLength(0);
  }),
);

const { code: receivedCode, link: receivedLink } = linkFixture();

interface ReceiveDraft {
  readonly link?: AccountAddress;
  readonly destination?: DestinationAddress;
  readonly unclaimedFunds?: UnclaimedFundsId;
  readonly creditedAccount?: Address;
}

const receiveDraft = (
  overrides: ReceiveDraft,
  drafts = actors.drafts,
): UnsignedEnvelope =>
  drafts.linkReceive({
    link: receivedLink,
    destination: actors.wallet.address,
    unclaimedFunds: cancelBalance,
    ...overrides,
  });

const tamperedReceives: ReadonlyArray<
  readonly [string, () => UnsignedEnvelope]
> = [
  [
    "paying another destination",
    () => receiveDraft({ destination: actors.stranger }),
  ],
  [
    "crediting a token account at the wallet address instead of its USDC account",
    () => receiveDraft({ creditedAccount: address(actors.wallet.address) }),
  ],
  ["signed by another link key", () => receiveDraft({ link: actors.stranger })],
  [
    "claiming other unclaimed funds",
    () => receiveDraft({ unclaimedFunds: otherBalance }),
  ],
  ["returning rent to another sponsor", () => receiveDraft({}, strangerDrafts)],
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

            return new AssetDraft({ request: expiringRequest(build()) });
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
