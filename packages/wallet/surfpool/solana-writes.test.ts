import { expect, layer } from "@effect/vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { address, getBase58Decoder, getBase64Decoder } from "@solana/kit";
import { Database } from "@workspace/db";
import { USDC_MINT_ADDRESS } from "@workspace/orchid-links";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import {
  Approval,
  Asset,
  PositiveAmount,
  type SigningRequest,
} from "../src/contract";
import { chainLayer } from "../src/binding/chain.server";
import { Chain } from "../src/server/Chain.server";
import type { DepositPosition } from "../src/server/chain-deposits.server";
import type { Sealed } from "../src/server/chain-settlement.server";
import { WalletSettings } from "../src/server/settings.server";
import { solanaAccountChain } from "../src/solana/account-chain.server";
import {
  signaturesFor,
  signaturesPerRequest,
} from "../src/solana/address-history.server";
import { solanaDepositChain } from "../src/solana/deposit-chain.server";
import { solanaDraftChain } from "../src/solana/draft-chain.server";
import { decodeSealedEnvelope } from "../src/solana/envelope-codec";
import { solanaProfile } from "../src/solana/profile";
import { usdcAccountOf } from "../src/solana/program-addresses";
import type { RpcValue } from "../src/solana/rpc.server";
import {
  SolanaAccountAddress,
  SolanaUnclaimedFundsId,
} from "../src/solana/schemas";
import { solanaSeal, solanaSponsor } from "../src/solana/seal.server";
import { solanaSigningScheme } from "../src/solana/signing-scheme";
import { sponsoredFailuresIn } from "../src/solana/sponsored-failures.server";
import { solanaSubmission } from "../src/solana/submission.server";
import { solanaUnclaimedFunds } from "../src/solana/unclaimed-funds.server";
import { assertTagged } from "../test/tagged";
import { dbLayer, useMigratedDatabase } from "../test/test-database";
import { Surfnet, surfnetLayer } from "./surfnet";

useMigratedDatabase();

const usdc = Schema.decodeSync(Asset)(solanaProfile.baseAsset);

const amountOf = (units: bigint) =>
  Schema.decodeSync(PositiveAmount)(units.toString());

const SolanaClaimPlan = Schema.TaggedStruct("ClaimPlan", {
  unclaimedFunds: SolanaUnclaimedFundsId,
});

const base58Decoder = getBase58Decoder();
const base64Decoder = getBase64Decoder();

const newKey = Effect.sync(() => {
  const seed = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(seed);

  return {
    seed,
    publicKey,
    account: Schema.decodeSync(SolanaAccountAddress)(
      base58Decoder.decode(publicKey),
    ),
  };
});

type Key = Effect.Success<typeof newKey>;

const cheat = (method: string, params: ReadonlyArray<RpcValue>) =>
  Effect.flatMap(Surfnet, (rpc) => rpc.call(method, params, Schema.Json));

const fundUsdc = (key: Key, amount: number) =>
  cheat("surfnet_setTokenAccount", [
    key.account,
    USDC_MINT_ADDRESS,
    { amount },
    TOKEN_PROGRAM_ADDRESS,
  ]);

const writer = Effect.gen(function* () {
  const rpc = yield* Surfnet;
  const sponsorKey = yield* newKey;

  yield* cheat("surfnet_setAccount", [
    sponsorKey.account,
    { lamports: 100_000_000_000 },
  ]);

  const sponsor = solanaSponsor(
    concatBytes(sponsorKey.seed, sponsorKey.publicKey),
  );

  const drafts = solanaDraftChain(rpc, sponsor.address);
  const seal = solanaSeal(sponsor);

  const submission = solanaSubmission(
    rpc,
    sponsoredFailuresIn(yield* Database),
  );

  const accounts = solanaAccountChain(rpc, sponsorKey.account);
  const unclaimed = solanaUnclaimedFunds(rpc, sponsorKey.account);
  const deposits = solanaDepositChain(rpc);

  const sealedBy = (request: SigningRequest, key: Key) =>
    seal(
      request,
      new Approval({
        signature: ed25519.sign(
          solanaSigningScheme.signingPayload(request.envelope),
          key.seed,
        ),
      }),
      key.account,
    );

  const concluded = (sealed: Sealed) =>
    submission.settlement(sealed).pipe(
      Effect.repeat({
        until: (settlement) => !Predicate.isTagged(settlement, "Undecided"),
        schedule: Schedule.spaced("100 millis"),
      }),
    );

  const land = Effect.fn("land")(function* (request: SigningRequest, key: Key) {
    const sealed = yield* sealedBy(request, key);

    yield* submission.submit(sealed);

    return yield* concluded(sealed);
  });

  const open = Effect.fn("open")(function* (usdcUnits = 0) {
    const key = yield* newKey;
    const draft = yield* drafts.draftOpening(key.account);

    expect((yield* land(draft.request, key))._tag).toBe("Applied");

    if (usdcUnits > 0) yield* fundUsdc(key, usdcUnits);

    return key;
  });

  const createLink = Effect.fn("createLink")(function* (
    sender: Key,
    units: bigint,
  ) {
    const link = yield* newKey;

    const request = yield* drafts.draftPaymentLink(
      sender.account,
      link.account,
      usdc,
      amountOf(units),
    );

    expect((yield* land(request, sender))._tag).toBe("Applied");

    return {
      link,
      unclaimedFunds: Option.getOrThrow(
        drafts.unclaimedFundsCreatedBy(request),
      ),
    };
  });

  return {
    drafts,
    submission,
    accounts,
    unclaimed,
    deposits,
    sealedBy,
    concluded,
    land,
    open,
    createLink,
  };
});

const balances = (
  accounts: Effect.Success<typeof writer>["accounts"],
  keys: ReadonlyArray<Key>,
) =>
  Effect.forEach(keys, (key) =>
    accounts.balance(key.account).pipe(Effect.map(Option.getOrUndefined)),
  );

layer(Layer.mergeAll(surfnetLayer, dbLayer), {
  excludeTestServices: true,
  timeout: "120 seconds",
})((it) => {
  it.effect(
    "opens wallets, sends, and pays out two links to a new wallet and a payout partner",
    () =>
      Effect.gen(function* () {
        const {
          accounts,
          drafts,
          unclaimed,
          deposits,
          land,
          open,
          createLink,
        } = yield* writer;

        const sender = yield* open(10_000_000);
        const recipient = yield* open();

        expect(yield* accounts.standing(sender.account)).toBe("open");

        const payment = yield* drafts.draftPayment(
          sender.account,
          recipient.account,
          usdc,
          amountOf(2_000_000n),
          { type: "text", value: "lunch" },
        );

        expect((yield* land(payment, sender))._tag).toBe("Applied");

        const claimed = yield* createLink(sender, 3_000_000n);
        const paidOut = yield* createLink(sender, 1_000_000n);
        const newWallet = yield* open();
        const partner = yield* open();

        const receive = (
          created: Effect.Success<ReturnType<typeof createLink>>,
          destination: Key,
          units: bigint,
        ) =>
          Effect.gen(function* () {
            const prepared = yield* drafts.prepareLinkReceive({
              link: created.link.account,
              destination: destination.account,
              unclaimedFunds: created.unclaimedFunds,
              asset: usdc,
              amount: amountOf(units),
            });

            return yield* land(
              yield* drafts.draftLinkReceive(prepared),
              created.link,
            );
          });

        const claim = yield* receive(claimed, newWallet, 3_000_000n);

        assertTagged(claim, "Applied");
        expect((yield* receive(paidOut, partner, 1_000_000n))._tag).toBe(
          "Applied",
        );

        expect(
          yield* balances(accounts, [sender, recipient, newWallet, partner]),
        ).toEqual([4_000_000n, 2_000_000n, 3_000_000n, 1_000_000n]);
        expect(
          yield* unclaimed.unclaimedFunds([
            claimed.unclaimedFunds,
            paidOut.unclaimedFunds,
          ]),
        ).toEqual([]);
        expect(
          yield* unclaimed.unclaimedFundsClosedAt(claimed.unclaimedFunds),
        ).toEqual(Option.some(claim.at));

        const pagesInto = (key: Key, after = Option.none<DepositPosition>()) =>
          Stream.runCollect(deposits.depositsInto(key.account, after));

        const listedHistory = (key: Key, transactions: number) =>
          Effect.flatMap(Surfnet, (rpc) =>
            signaturesFor(rpc, usdcAccountOf(address(key.account)), {
              before: Option.none(),
              until: Option.none(),
              limit: signaturesPerRequest,
            }),
          ).pipe(
            Effect.repeat({
              until: (entries) => entries.length >= transactions,
              schedule: Schedule.spaced("100 millis"),
            }),
          );

        yield* listedHistory(recipient, 2);

        const recipientPages = yield* pagesInto(recipient);

        expect(
          recipientPages.flatMap((page) =>
            page.deposits.map(({ from, amount }) => ({ from, amount })),
          ),
        ).toEqual([{ from: sender.account, amount: 2_000_000n }]);

        const newest = Option.fromUndefinedOr(recipientPages.at(-1)).pipe(
          Option.map((page) => page.position),
        );

        expect(yield* pagesInto(recipient, newest)).toEqual([]);
      }),
  );

  it.effect(
    "lets the sender reclaim a link only once the chain clock reaches its reclaim time",
    () =>
      Effect.gen(function* () {
        const { accounts, drafts, unclaimed, land, open, createLink } =
          yield* writer;

        const sender = yield* open(5_000_000);
        const { unclaimedFunds } = yield* createLink(sender, 2_000_000n);

        const reclaimAt = Effect.gen(function* () {
          const [entry] = yield* unclaimed.unclaimedFunds([unclaimedFunds]);
          const claim = Option.getOrThrow(entry.claimOf(sender.account));

          return {
            opensAt: Option.getOrThrow(claim.opensAt),
            claimable: claim.claimableAt(Option.getOrThrow(claim.opensAt)),
          };
        });

        const before = yield* reclaimAt;

        expect(before.claimable).toBe(false);

        yield* cheat("surfnet_timeTravel", [
          {
            absoluteTimestamp: DateTime.toEpochMillis(before.opensAt) + 60_000,
          },
        ]);

        yield* reclaimAt.pipe(
          Effect.repeat({
            until: ({ claimable }) => claimable,
            schedule: Schedule.spaced("100 millis"),
          }),
        );

        const reclaim = yield* drafts.draftAsset(
          sender.account,
          SolanaClaimPlan.make({ unclaimedFunds }),
        );

        expect((yield* land(reclaim, sender))._tag).toBe("Applied");
        expect(yield* balances(accounts, [sender])).toEqual([5_000_000n]);
        expect(yield* unclaimed.unclaimedFunds([unclaimedFunds])).toEqual([]);
      }),
  );

  it.effect(
    "stops sponsoring a wallet whose sponsored transactions keep landing and failing",
    () =>
      Effect.gen(function* () {
        const { drafts, submission, sealedBy, concluded, open } = yield* writer;
        const rpc = yield* Surfnet;

        const sender = yield* open(1_000_000);
        const recipient = yield* open();

        const paying = (units: bigint) =>
          drafts
            .draftPayment(
              sender.account,
              recipient.account,
              usdc,
              amountOf(units),
            )
            .pipe(Effect.flatMap((request) => sealedBy(request, sender)));

        const refusal = (sealed: Sealed) =>
          Effect.flip(submission.submit(sealed)).pipe(
            Effect.map((failure) =>
              Predicate.isTagged(failure, "SubmissionRejected")
                ? failure.code
                : failure._tag,
            ),
          );

        expect(yield* refusal(yield* paying(2_000_000n))).toBe(
          "InstructionError",
        );

        yield* Effect.forEach([2_000_001n, 2_000_002n, 2_000_003n], (units) =>
          Effect.gen(function* () {
            const sealed = yield* paying(units);

            const { transactionBytes } = Option.getOrThrow(
              decodeSealedEnvelope(sealed.envelope),
            );

            yield* rpc.call(
              "sendTransaction",
              [
                base64Decoder.decode(transactionBytes),
                { encoding: "base64", skipPreflight: true },
              ],
              Schema.String,
            );

            expect((yield* concluded(sealed))._tag).toBe("Rejected");
          }),
        );

        expect(yield* refusal(yield* paying(500_000n))).toBe(
          "sponsored_failure_limit",
        );
      }),
  );
  it.effect(
    "the bound chain layer opens a wallet with the sponsor from its settings and refuses a destination without a USDC account",
    () =>
      Effect.gen(function* () {
        const { url } = yield* Surfnet;
        const sponsorKey = yield* newKey;
        const owner = yield* newKey;
        const stranger = yield* newKey;

        yield* cheat("surfnet_setAccount", [
          sponsorKey.account,
          { lamports: 100_000_000_000 },
        ]);

        const chain = yield* Chain.pipe(
          Effect.provide(
            chainLayer.pipe(
              Layer.provide(
                Layer.succeed(WalletSettings, {
                  rpcUrl: url,
                  sponsorSecret: Redacted.make(
                    base58Decoder.decode(
                      concatBytes(sponsorKey.seed, sponsorKey.publicKey),
                    ),
                  ),
                  passkeyOrigins: [],
                  humanCheckSecret: Redacted.make("unused"),
                  sessionSecret: Redacted.make("unused"),
                }),
              ),
              Layer.provide(FetchHttpClient.layer),
            ),
          ),
        );

        const draft = yield* chain.draftOpening(owner.account);

        const sealed = yield* chain.seal(
          draft.request,
          new Approval({
            signature: ed25519.sign(
              solanaSigningScheme.signingPayload(draft.request.envelope),
              owner.seed,
            ),
          }),
          owner.account,
        );

        yield* chain.submit(sealed);

        const settled = yield* chain.settlement(sealed).pipe(
          Effect.repeat({
            until: (settlement) => !Predicate.isTagged(settlement, "Undecided"),
            schedule: Schedule.spaced("100 millis"),
          }),
        );

        expect({
          settled: settled._tag,
          standing: yield* chain.standing(owner.account),
          blocker: yield* chain.receiveBlocker(
            stranger.account,
            usdc,
            amountOf(1n),
          ),
        }).toEqual({
          settled: "Applied",
          standing: "open",
          blocker: Option.some("no_account"),
        });
      }),
  );
});
