import { expect, layer } from "@effect/vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { base58 } from "@scure/base";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  AssetOrder,
  AssetOrderId,
  ClaimUnclaimedFunds,
  type DestinationAddress,
  ExternalLinkOrder,
  LinkUnclaimable,
  PaymentLinkUsed,
  PaymentMemo,
  ReceiveLink,
  RecipientCannotReceive,
  UnclaimedFundsGone,
  baseAsset,
} from "../src/contract";
import { assertTagged } from "./tagged";
import { randomAddress, randomKey } from "./test-keys";
import {
  addressOf,
  amount,
  approve,
  euroLine,
  fundHolder,
  fundLink,
  fundedWallet,
  holdingsFor,
  settleHash,
  sponsorSeed,
  useDisposableDatabase,
  walletTestLayer,
  world,
} from "./solana-harness";

useDisposableDatabase();

const releasedOnce = <A, E>(release: Effect.Effect<A, E>, since: number) =>
  Effect.gen(function* () {
    const released = yield* release;
    const replayed = yield* release;
    const hashes = new Set(world.submitted.slice(since).map((s) => s.hash));

    return { released, replayed, hashes };
  });

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "a link receive replayed after its approval pays once and shows the sender a received link",
      () =>
        Effect.gen(function* () {
          const { wallet, sender, link, unclaimedFunds } =
            yield* fundLink("linkfunder");

          const recipient = yield* fundedWallet("linkreceiver");

          const receiveOrder = () =>
            new AssetOrder({
              id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
              wallet: addressOf(recipient),
              action: ReceiveLink.make({
                link: addressOf(link),
                unclaimedFunds,
              }),
            });

          const receive = receiveOrder();
          const drafted = yield* wallet.manage(receive, Option.none());

          assertTagged(drafted, "AssetDraft");

          const { released, replayed, hashes } = yield* releasedOnce(
            wallet.manage(receive, approve(drafted.request, link)),
            world.submitted.length,
          );

          assertTagged(released, "AssetPending");
          expect(replayed).toEqual(released);
          expect(hashes.size).toBe(1);

          for (const hash of hashes) settleHash(hash);

          expect((yield* wallet.manage(receive, Option.none()))._tag).toBe(
            "AssetSettled",
          );
          expect(yield* wallet.manage(receiveOrder(), Option.none())).toEqual(
            new UnclaimedFundsGone({ status: "claimed" }),
          );
          expect(yield* wallet.paymentLink(addressOf(link))).toEqual(
            new PaymentLinkUsed(),
          );

          const listed = yield* wallet.paymentLinks(sender.address);

          assertTagged(listed, "OpenPaymentLinks");
          expect({
            open: listed.links,
            received: listed.received.map((entry) => entry.address),
          }).toEqual({ open: [], received: [addressOf(link)] });
        }),
    );

    it.effect(
      "an external link claim with a text memo pays once across replay and leaves nothing for the sender to reclaim",
      () =>
        Effect.gen(function* () {
          const { wallet, sender, link, unclaimedFunds } =
            yield* fundLink("extfunder");

          const external = randomKey();

          fundHolder(external);

          const claimOrder = () =>
            new ExternalLinkOrder({
              id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
              link: addressOf(link),
              unclaimedFunds,
              destination: addressOf(external),
              memo: Schema.decodeSync(PaymentMemo)({
                type: "text",
                value: "001234",
              }),
            });

          const claim = claimOrder();
          const drafted = yield* wallet.claimPaymentLink(claim, Option.none());

          assertTagged(drafted, "ExternalLinkDraft");

          const { released, replayed, hashes } = yield* releasedOnce(
            wallet.claimPaymentLink(claim, approve(drafted.request, link)),
            world.submitted.length,
          );

          assertTagged(released, "ExternalLinkPending");
          expect(replayed).toEqual(released);
          expect(hashes.size).toBe(1);

          for (const hash of hashes) settleHash(hash);

          expect(
            (yield* wallet.claimPaymentLink(claim, Option.none()))._tag,
          ).toBe("ExternalLinkSettled");
          expect(
            yield* wallet.claimPaymentLink(claimOrder(), Option.none()),
          ).toEqual(new UnclaimedFundsGone({ status: "claimed" }));
          expect(
            yield* wallet.manage(
              new AssetOrder({
                id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
                wallet: sender.address,
                action: ClaimUnclaimedFunds.make({ unclaimedFunds }),
              }),
              Option.none(),
            ),
          ).toEqual(new UnclaimedFundsGone({ status: "claimed" }));
        }),
    );

    it.effect(
      "the sandbox payout partner quotes a link to the deposit address derived from the sponsor key",
      () =>
        Effect.gen(function* () {
          const { wallet, link } = yield* fundLink("sandboxfunder");
          const quote = yield* wallet.quotePayout(addressOf(link), "PEN");

          assertTagged(quote, "PayoutQuote");
          expect(quote.depositAddress).toBe(
            base58.encode(
              ed25519.getPublicKey(
                sha256(
                  concatBytes(
                    sponsorSeed,
                    new TextEncoder().encode("orchid sandbox payout partner"),
                  ),
                ),
              ),
            ),
          );
        }),
    );

    const heldUsdc = (
      overrides: Partial<ReturnType<typeof euroLine>>,
    ): AccountAddress => {
      const holder = randomAddress();

      world.holdings.set(
        holder,
        holdingsFor(holder, {
          lines: [{ ...euroLine("0"), asset: baseAsset, ...overrides }],
        }),
      );

      return holder;
    };

    const refusalCases: ReadonlyArray<
      readonly [
        string,
        (link: AccountAddress) => {
          readonly destination: DestinationAddress;
          readonly expected: RecipientCannotReceive | LinkUnclaimable;
        },
      ]
    > = [
      [
        "a destination with no USDC account",
        () => {
          const missing = randomAddress();

          return {
            destination: missing,
            expected: new RecipientCannotReceive({
              address: missing,
              reason: "no_account",
            }),
          };
        },
      ],
      [
        "a frozen USDC account",
        () => {
          const destination = heldUsdc({ authorized: false });

          return {
            destination,
            expected: new RecipientCannotReceive({
              address: destination,
              reason: "not_authorized",
            }),
          };
        },
      ],
      [
        "a USDC account without room for the amount",
        () => {
          const destination = heldUsdc({ capacity: amount("999999") });

          return {
            destination,
            expected: new RecipientCannotReceive({
              address: destination,
              reason: "no_capacity",
            }),
          };
        },
      ],
      [
        "the link itself",
        (link) => ({
          destination: link,
          expected: new LinkUnclaimable({ reason: "destination_is_link" }),
        }),
      ],
    ];

    it.effect.each(refusalCases)(
      "external claim refuses %s before signing and leaves the unclaimed funds reclaimable by sender",
      ([, setup]) =>
        Effect.gen(function* () {
          const { wallet, sender, link, unclaimedFunds } =
            yield* fundLink("refusalfunder");

          const { destination, expected } = setup(addressOf(link));
          const submissionsBefore = world.submitted.length;

          const outcome = yield* wallet.claimPaymentLink(
            new ExternalLinkOrder({
              id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
              link: addressOf(link),
              unclaimedFunds,
              destination,
            }),
            Option.none(),
          );

          expect(outcome).toEqual(expected);
          expect(world.submitted).toHaveLength(submissionsBefore);

          const reclaim = yield* wallet.manage(
            new AssetOrder({
              id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
              wallet: sender.address,
              action: ClaimUnclaimedFunds.make({ unclaimedFunds }),
            }),
            Option.none(),
          );

          assertTagged(reclaim, "AssetDraft");
        }),
    );
  },
);
