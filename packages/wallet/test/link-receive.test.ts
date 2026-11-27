import { expect, it, layer } from "@effect/vitest";
import { Account, Keypair, MuxedAccount } from "@stellar/stellar-sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  AssetOrder,
  AssetOrderId,
  UnclaimedFundsGone,
  UnclaimedFundsId,
  ClaimUnclaimedFunds,
  DestinationAddress,
  ExternalLinkOrder,
  ExternalMemoRequired,
  InvalidAddress,
  LedgerUnreachable,
  LinkUnclaimable,
  MemoNotAllowed,
  PaymentLinkUsed,
  PaymentMemo,
  ReceiveLink,
  RecipientCannotReceive,
  baseAsset,
} from "../src/contract";
import { KnownExchangeMemo } from "../src/stellar/exchange-memos.server";
import { readEnvelope } from "../src/stellar/envelopes";
import { draftLinkReceive } from "../src/stellar/link-receive";
import { network, usdc } from "../src/stellar/network";
import { sandboxPartnerKeypair } from "../src/stellar/sandbox-partner";
import { assertTagged } from "./tagged";
import {
  fundLink,
  linkAmount,
  accountState,
  addressOf,
  amount,
  approve,
  euroLine,
  fundHolder,
  fundedWallet,
  holdingsFor,
  settleHash,
  useDisposableDatabase,
  walletTestLayer,
  world,
  exchangeMemos,
  activityOf,
  claimExternally,
  feePayer,
  username,
} from "./stellar-harness";

const envelopeBalance = Schema.decodeSync(UnclaimedFundsId)(
  `00000000${"a".repeat(64)}`,
);

it("link receive envelope reader rejects a muxed destination with a memo", () => {
  const muxed = Schema.decodeSync(DestinationAddress)(
    new MuxedAccount(
      new Account(addressOf(Keypair.random()), "0"),
      "42",
    ).accountId(),
  );

  const envelope = draftLinkReceive({
    channel: new Account(addressOf(Keypair.random()), "100"),
    link: addressOf(Keypair.random()),
    reserveSponsor: addressOf(Keypair.random()),
    createsLinkAccount: true,
    destination: muxed,
    unclaimedFunds: envelopeBalance,
    asset: baseAsset,
    amount: linkAmount,
    memo: Schema.decodeSync(PaymentMemo)({ type: "text", value: "12345" }),
    minTime: 100,
    maxTime: 220,
  });

  expect(Option.isNone(readEnvelope(envelope))).toBe(true);
});

useDisposableDatabase();

const registerExchange = (address: AccountAddress) => {
  const entry = new KnownExchangeMemo({
    network,
    address,
    exchange: "Exchange",
    source: "https://stellar.org/protocol/sep-29",
  });

  exchangeMemos.push(entry);

  return entry;
};

layer(walletTestLayer, { excludeTestServices: true, concurrent: false })(
  (it) => {
    it.effect(
      "a link receive replayed after its approval pays once, cleans up its link account and shows the sender a received link",
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

          const approval = approve(drafted.request, link);
          const fundingSubmissions = world.submitted.length;
          const released = yield* wallet.manage(receive, approval);
          const replayed = yield* wallet.manage(receive, approval);

          assertTagged(released, "AssetPending");
          expect(replayed).toEqual(released);

          const receipts = new Set(
            world.submitted
              .slice(fundingSubmissions)
              .map((sealed) => sealed.hash),
          );

          expect(receipts.size).toBe(1);

          for (const hash of receipts) settleHash(hash);

          world.claimables.delete(unclaimedFunds);

          expect((yield* wallet.manage(receive, Option.none()))._tag).toBe(
            "AssetSettled",
          );
          expect(yield* wallet.manage(receiveOrder(), Option.none())).toEqual(
            new UnclaimedFundsGone({ status: "claimed" }),
          );
          expect(yield* wallet.paymentLink(addressOf(link))).toEqual(
            new PaymentLinkUsed(),
          );
          expect(world.accounts.has(addressOf(link))).toBe(false);

          const listed = yield* wallet.paymentLinks(sender.address);

          assertTagged(listed, "OpenPaymentLinks");
          expect({
            open: listed.links,
            received: listed.received.map((entry) => entry.address),
          }).toEqual({ open: [], received: [addressOf(link)] });
        }),
    );

    it.effect(
      "an external link claim with a digits text memo pays once across replay, cleans up, and marks the link claimed",
      () =>
        Effect.gen(function* () {
          const { wallet, sender, link, unclaimedFunds } =
            yield* fundLink("extfunder");

          const external = Keypair.random();

          fundHolder(external);
          registerExchange(addressOf(external));

          const memo = Schema.decodeSync(PaymentMemo)({
            type: "text",
            value: "001234",
          });

          const claimOrder = () =>
            new ExternalLinkOrder({
              id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
              link: addressOf(link),
              unclaimedFunds,
              destination: addressOf(external),
              memo,
            });

          world.accounts.set(addressOf(link), accountState());

          const claim = claimOrder();
          const drafted = yield* wallet.claimPaymentLink(claim, Option.none());

          assertTagged(drafted, "ExternalLinkDraft");
          expect(drafted.memoRequired).toBe(true);

          const facts = Option.getOrThrow(
            readEnvelope(drafted.request.envelope),
          );

          assertTagged(facts, "LinkReceiveFacts");
          expect(facts.createsLinkAccount).toBe(false);
          expect(facts.destination).toBe(addressOf(external));
          expect(facts.memo).toEqual(memo);

          const approval = approve(drafted.request, link);
          const beforeSubmit = world.submitted.length;
          const released = yield* wallet.claimPaymentLink(claim, approval);
          const replayed = yield* wallet.claimPaymentLink(claim, approval);

          assertTagged(released, "ExternalLinkPending");
          expect(replayed).toEqual(released);

          const hashes = new Set(
            world.submitted.slice(beforeSubmit).map((sealed) => sealed.hash),
          );

          expect(hashes.size).toBe(1);

          for (const hash of hashes) settleHash(hash);

          world.claimables.delete(unclaimedFunds);

          expect(
            (yield* wallet.claimPaymentLink(claim, Option.none()))._tag,
          ).toBe("ExternalLinkSettled");
          expect(
            yield* wallet.claimPaymentLink(claimOrder(), Option.none()),
          ).toEqual(new UnclaimedFundsGone({ status: "claimed" }));
          expect(yield* wallet.paymentLink(addressOf(link))).toEqual(
            new PaymentLinkUsed(),
          );
          expect(world.accounts.has(addressOf(link))).toBe(false);

          const reclaim = new AssetOrder({
            id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
            wallet: sender.address,
            action: ClaimUnclaimedFunds.make({ unclaimedFunds }),
          });

          expect(yield* wallet.manage(reclaim, Option.none())).toEqual(
            new UnclaimedFundsGone({ status: "claimed" }),
          );

          const listed = yield* wallet.paymentLinks(sender.address);

          assertTagged(listed, "OpenPaymentLinks");
          expect(listed.received.map((entry) => entry.address)).toEqual([
            addressOf(link),
          ]);
        }),
    );

    it.effect(
      "the sandbox payout partner quotes a link to the deposit address derived from the fee payer",
      () =>
        Effect.gen(function* () {
          const { wallet, link } = yield* fundLink("sandboxfunder");

          world.accounts.set(addressOf(link), accountState());

          const quote = yield* wallet.quotePayout(addressOf(link));

          assertTagged(quote, "PayoutQuote");
          expect(quote.depositAddress).toBe(
            sandboxPartnerKeypair(feePayer).publicKey(),
          );
        }),
    );

    it.effect(
      "lists a link claimed to a wallet's muxed address as that wallet's claim",
      () =>
        Effect.gen(function* () {
          const funded = yield* fundLink("muxedfunder");
          const claimer = addressOf(yield* fundedWallet("muxedclaimer"));

          yield* claimExternally(
            funded.wallet,
            funded,
            Schema.decodeSync(DestinationAddress)(
              new MuxedAccount(new Account(claimer, "0"), "42").accountId(),
            ),
          );

          const claimed = yield* activityOf(funded.wallet, claimer);

          expect(claimed.entries).toHaveLength(1);

          const [entry] = claimed.entries;

          assertTagged(entry, "ClaimedLinkActivity");
          expect(entry.from.username).toBe(username("muxedfunder"));
          expect(entry.amount).toBe(linkAmount);
        }),
    );

    it.effect(
      "an external claim to a muxed destination skips SEP-29 and drafts with no memo",
      () =>
        Effect.gen(function* () {
          const { wallet, link, unclaimedFunds } =
            yield* fundLink("muxedfunder");

          const base = Keypair.random();

          fundHolder(base);
          registerExchange(addressOf(base));

          const muxed = Schema.decodeSync(DestinationAddress)(
            new MuxedAccount(
              new Account(addressOf(base), "0"),
              "42",
            ).accountId(),
          );

          const drafted = yield* wallet.claimPaymentLink(
            new ExternalLinkOrder({
              id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
              link: addressOf(link),
              unclaimedFunds,
              destination: muxed,
            }),
            Option.none(),
          );

          assertTagged(drafted, "ExternalLinkDraft");
          expect(drafted.memoRequired).toBe(false);

          const facts = Option.getOrThrow(
            readEnvelope(drafted.request.envelope),
          );

          assertTagged(facts, "LinkReceiveFacts");
          expect(facts.destination).toBe(muxed);
          expect(facts.memo).toBeUndefined();
        }),
    );

    const refusalCases: ReadonlyArray<
      readonly [
        string,
        (link: AccountAddress) => {
          readonly destination: DestinationAddress;
          readonly memo?: PaymentMemo;
          readonly expected:
            | InvalidAddress
            | ExternalMemoRequired
            | MemoNotAllowed
            | RecipientCannotReceive
            | LinkUnclaimable
            | LedgerUnreachable;
        },
      ]
    > = [
      [
        "invalid destination checksum",
        () => {
          const invalid = Schema.decodeSync(AccountAddress)(
            `G${"A".repeat(55)}`,
          );

          return {
            destination: invalid,
            expected: new InvalidAddress({ address: invalid }),
          };
        },
      ],
      [
        "missing account",
        () => {
          const missing = addressOf(Keypair.random());

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
        "missing trustline",
        () => {
          const target = Keypair.random();
          const addr = addressOf(target);

          world.accounts.set(addr, accountState({ balance: Option.none() }));

          return {
            destination: addr,
            expected: new RecipientCannotReceive({
              address: addr,
              reason: "no_trustline",
            }),
          };
        },
      ],
      [
        "unauthorized trustline",
        () => {
          const addr = addressOf(Keypair.random());

          world.holdings.set(
            addr,
            holdingsFor(addr, {
              lines: [
                {
                  ...euroLine("0"),
                  asset: baseAsset,
                  authorized: false,
                },
              ],
            }),
          );

          return {
            destination: addr,
            expected: new RecipientCannotReceive({
              address: addr,
              reason: "not_authorized",
            }),
          };
        },
      ],
      [
        "insufficient trustline capacity",
        () => {
          const addr = addressOf(Keypair.random());

          world.holdings.set(
            addr,
            holdingsFor(addr, {
              lines: [
                {
                  ...euroLine("0", { capacity: amount("9999999") }),
                  asset: baseAsset,
                },
              ],
            }),
          );

          return {
            destination: addr,
            expected: new RecipientCannotReceive({
              address: addr,
              reason: "no_capacity",
            }),
          };
        },
      ],
      [
        "SEP-29 destination without memo",
        () => {
          const target = Keypair.random();

          fundHolder(target);
          const entry = registerExchange(addressOf(target));

          return {
            destination: entry.address,
            expected: new ExternalMemoRequired({
              address: entry.address,
              exchange: entry.exchange,
              source: entry.source,
            }),
          };
        },
      ],
      [
        "failed SEP-29 lookup (fail closed)",
        () => {
          const target = Keypair.random();

          fundHolder(target);
          world.ledgerDown = true;

          return {
            destination: addressOf(target),
            expected: new LedgerUnreachable(),
          };
        },
      ],
      [
        "separate memo with muxed address",
        () => {
          const target = Keypair.random();

          fundHolder(target);

          return {
            destination: Schema.decodeSync(DestinationAddress)(
              new MuxedAccount(
                new Account(addressOf(target), "0"),
                "7",
              ).accountId(),
            ),
            memo: Schema.decodeSync(PaymentMemo)({
              type: "text",
              value: "12345",
            }),
            expected: new MemoNotAllowed({ reason: "muxed" }),
          };
        },
      ],
      [
        "destination equal to link",
        (link) => ({
          destination: link,
          expected: new LinkUnclaimable({ reason: "destination_is_link" }),
        }),
      ],
      [
        "destination equal to asset issuer",
        () => ({
          destination: Schema.decodeUnknownSync(AccountAddress)(usdc.issuer),
          expected: new LinkUnclaimable({ reason: "destination_is_issuer" }),
        }),
      ],
      [
        "link account holding signers or subentries",
        (link) => {
          const target = Keypair.random();

          fundHolder(target);
          world.accounts.set(link, accountState({ untouched: false }));

          return {
            destination: addressOf(target),
            expected: new LinkUnclaimable({
              reason: "link_account_unexpected",
            }),
          };
        },
      ],
    ];

    it.effect.each(refusalCases)(
      "external claim refuses %s before signing and leaves the unclaimed funds reclaimable by sender",
      ([, setup]) =>
        Effect.gen(function* () {
          const { wallet, sender, link, unclaimedFunds } =
            yield* fundLink("refusalfunder");

          const { destination, memo, expected } = setup(addressOf(link));
          const submissionsBefore = world.submitted.length;

          const order = new ExternalLinkOrder({
            id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
            link: addressOf(link),
            unclaimedFunds,
            destination,
            memo,
          });

          const outcome = yield* wallet
            .claimPaymentLink(order, Option.none())
            .pipe(Effect.catch((failure) => Effect.succeed(failure)));

          world.ledgerDown = false;
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
