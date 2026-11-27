import { expect, layer } from "@effect/vitest";
import {
  AccountState,
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getTokenEncoder,
} from "@solana-program/token";
import {
  type Address,
  type ReadonlyUint8Array,
  address,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase16Decoder,
  getI64Encoder,
  getStructEncoder,
  getU64Encoder,
  getU8Encoder,
  none,
} from "@solana/kit";
import {
  ORCHID_LINKS_PROGRAM_ADDRESS,
  UNCLAIMED_FUNDS_DISCRIMINATOR,
  USDC_MINT_ADDRESS,
  findUnclaimedFundsAddress,
} from "@workspace/orchid-links";
import * as Arr from "effect/Array";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import { Asset } from "../src/contract";
import { solanaAccountChain } from "../src/solana/account-chain.server";
import { solanaHoldings } from "../src/solana/holdings.server";
import { solanaProfile } from "../src/solana/profile";
import { type RpcValue } from "../src/solana/rpc.server";
import {
  SolanaAccountAddress,
  SolanaUnclaimedFundsId,
} from "../src/solana/schemas";
import { solanaUnclaimedFunds } from "../src/solana/unclaimed-funds.server";
import { Surfnet, surfnetLayer } from "./surfnet";

const newAddress = Effect.promise(() => generateKeyPairSigner()).pipe(
  Effect.map((signer) => signer.address),
);

const newAccountAddress = newAddress.pipe(
  Effect.map((key) => Schema.decodeSync(SolanaAccountAddress)(key)),
);

const cheat = (method: string, params: ReadonlyArray<RpcValue>) =>
  Effect.flatMap(Surfnet, (rpc) => rpc.call(method, params, Schema.Json));

const writeAccount = (
  account: Address,
  owner: Address,
  data: ReadonlyUint8Array,
) =>
  cheat("surfnet_setAccount", [
    account,
    {
      owner,
      data: getBase16Decoder().decode(data),
      lamports: 10_000_000,
      executable: false,
    },
  ]);

const usdcAccountAddress = (wallet: Address) =>
  Effect.promise(() =>
    findAssociatedTokenPda({
      owner: wallet,
      mint: USDC_MINT_ADDRESS,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    }),
  ).pipe(Effect.map(([account]) => account));

const setUsdc = (
  wallet: Address,
  update: { readonly [key: string]: RpcValue },
) =>
  cheat("surfnet_setTokenAccount", [
    wallet,
    USDC_MINT_ADDRESS,
    update,
    TOKEN_PROGRAM_ADDRESS,
  ]);

const writeUsdcAccountContents = (
  wallet: Address,
  contents: { readonly mint: Address; readonly owner: Address },
) =>
  Effect.flatMap(usdcAccountAddress(wallet), (account) =>
    writeAccount(
      account,
      TOKEN_PROGRAM_ADDRESS,
      getTokenEncoder().encode({
        ...contents,
        amount: 7_000_000n,
        delegate: none(),
        state: AccountState.Initialized,
        isNative: none(),
        delegatedAmount: 0n,
        closeAuthority: none(),
      }),
    ),
  );

interface Parties {
  readonly wallet: Address;
  readonly sponsor: Address;
  readonly stranger: Address;
}

const usdc = Schema.decodeSync(Asset)(solanaProfile.baseAsset);
const maximum = 9_223_372_036_854_775_807n;

const accountCases = [
  {
    name: "has no USDC account",
    arrange: () => Effect.void,
    standing: "absent",
    balance: Option.none<bigint>(),
    line: Option.none(),
  },
  {
    name: "has a USDC account only the sponsor can close",
    arrange: ({ wallet, sponsor }: Parties) =>
      setUsdc(wallet, { amount: 7_000_000, closeAuthority: sponsor }),
    standing: "open",
    balance: Option.some(7_000_000n),
    line: Option.some({
      spendable: 7_000_000n,
      capacity: maximum - 7_000_000n,
      authorized: true,
      sponsored: true,
    }),
  },
  {
    name: "has a USDC account only its owner can close",
    arrange: ({ wallet }: Parties) => setUsdc(wallet, { amount: 7_000_000 }),
    standing: "incomplete",
    balance: Option.some(7_000_000n),
    line: Option.some({
      spendable: 7_000_000n,
      capacity: maximum - 7_000_000n,
      authorized: true,
      sponsored: false,
    }),
  },
  {
    name: "named itself as the closer of its USDC account",
    arrange: ({ wallet }: Parties) =>
      setUsdc(wallet, { amount: 7_000_000, closeAuthority: wallet }),
    standing: "incomplete",
    balance: Option.some(7_000_000n),
    line: Option.some({
      spendable: 7_000_000n,
      capacity: maximum - 7_000_000n,
      authorized: true,
      sponsored: false,
    }),
  },
  {
    name: "has a USDC account a stranger can close",
    arrange: ({ wallet, stranger }: Parties) =>
      setUsdc(wallet, { amount: 7_000_000, closeAuthority: stranger }),
    standing: "foreignIncomplete",
    balance: Option.some(7_000_000n),
    line: Option.some({
      spendable: 7_000_000n,
      capacity: maximum - 7_000_000n,
      authorized: true,
      sponsored: false,
    }),
  },
  {
    name: "has a frozen USDC account",
    arrange: ({ wallet, sponsor }: Parties) =>
      setUsdc(wallet, {
        amount: 7_000_000,
        state: "frozen",
        closeAuthority: sponsor,
      }),
    standing: "open",
    balance: Option.some(7_000_000n),
    line: Option.some({
      spendable: 0n,
      capacity: 0n,
      authorized: false,
      sponsored: true,
    }),
  },
  {
    name: "gave its USDC account to another owner",
    arrange: ({ wallet, stranger }: Parties) =>
      writeUsdcAccountContents(wallet, {
        mint: USDC_MINT_ADDRESS,
        owner: stranger,
      }),
    standing: "foreign",
    balance: Option.none<bigint>(),
    line: Option.none(),
  },
  {
    name: "has another mint at its USDC account address",
    arrange: ({ wallet, stranger }: Parties) =>
      writeUsdcAccountContents(wallet, { mint: stranger, owner: wallet }),
    standing: "foreign",
    balance: Option.none<bigint>(),
    line: Option.none(),
  },
];

const unclaimedFundsEncoder = getStructEncoder([
  ["sender", getAddressEncoder()],
  ["link", getAddressEncoder()],
  ["mint", getAddressEncoder()],
  ["rentRecipient", getAddressEncoder()],
  ["amount", getU64Encoder()],
  ["reclaimableAt", getI64Encoder()],
  ["bump", getU8Encoder()],
]);

const writeUnclaimedFunds = Effect.fn("writeUnclaimedFunds")(function* (held: {
  readonly sender: Address;
  readonly link: Address;
  readonly rentRecipient: Address;
  readonly program?: Address;
}) {
  const [account, bump] = yield* Effect.promise(() =>
    findUnclaimedFundsAddress(
      held.sender,
      held.link,
      crypto.getRandomValues(new Uint8Array(16)),
    ),
  );

  yield* writeAccount(
    account,
    held.program ?? ORCHID_LINKS_PROGRAM_ADDRESS,
    Uint8Array.of(
      ...UNCLAIMED_FUNDS_DISCRIMINATOR,
      ...unclaimedFundsEncoder.encode({
        ...held,
        mint: USDC_MINT_ADDRESS,
        amount: 5_500_001n,
        reclaimableAt: 1_700_000_000n,
        bump,
      }),
    ),
  );

  return Schema.decodeSync(SolanaUnclaimedFundsId)(account);
});

layer(surfnetLayer, { excludeTestServices: true, timeout: "30 seconds" })(
  (it) => {
    it.effect.each(accountCases)(
      "reads a wallet that $name",
      ({ arrange, standing, balance, line }) =>
        Effect.gen(function* () {
          const rpc = yield* Surfnet;
          const wallet = yield* newAccountAddress;
          const sponsor = yield* newAccountAddress;
          const stranger = yield* newAddress;

          yield* arrange({
            wallet: address(wallet),
            sponsor: address(sponsor),
            stranger,
          });

          const accounts = solanaAccountChain(rpc, sponsor);

          expect(yield* accounts.standing(wallet)).toBe(standing);
          expect(yield* accounts.balance(wallet)).toEqual(balance);

          const holdings = yield* solanaHoldings(rpc, sponsor).holdings(
            wallet,
            [usdc],
          );

          expect(Option.map(holdings, (state) => state.lines)).toEqual(
            Option.map(line, (expected) => [
              {
                ...expected,
                asset: usdc,
                balance: 7_000_000n,
                clawbackEnabled: false,
              },
            ]),
          );
          expect(
            Option.flatMap(holdings, (state) => state.reserveSponsor),
          ).toEqual(
            Option.liftPredicate(sponsor, () =>
              Option.exists(line, (expected) => expected.sponsored),
            ),
          );
        }),
    );

    it.effect(
      "finds unclaimed funds by address and by sender, trusting only the links program",
      () =>
        Effect.gen(function* () {
          const rpc = yield* Surfnet;
          const sponsor = yield* newAccountAddress;
          const sender = yield* newAccountAddress;
          const link = yield* newAccountAddress;
          const stranger = yield* newAccountAddress;
          const rentRecipient = address(sponsor);
          const held = { sender: address(sender), link: address(link) };

          const sponsored = yield* writeUnclaimedFunds({
            ...held,
            rentRecipient,
          });

          const unsponsored = yield* writeUnclaimedFunds({
            ...held,
            rentRecipient: address(stranger),
          });

          yield* writeUnclaimedFunds({
            ...held,
            sender: address(stranger),
            rentRecipient,
          });

          const impostor = yield* writeUnclaimedFunds({
            ...held,
            rentRecipient,
            program: address(stranger),
          });

          const reads = solanaUnclaimedFunds(rpc, sponsor);

          const found = yield* reads.unclaimedFunds([sponsored, impostor]);

          const beforeReclaim = DateTime.makeUnsafe(1_699_999_999_000);
          const reclaim = DateTime.makeUnsafe(1_700_000_000_000);

          expect(
            found.map((entry) => ({
              unclaimedFunds: entry.unclaimedFunds,
              asset: entry.asset,
              amount: entry.amount,
              linkClaimsEarly: Option.exists(entry.claimOf(link), (claim) =>
                claim.claimableAt(beforeReclaim),
              ),
              senderClaims: Option.map(entry.claimOf(sender), (claim) => ({
                opensAt: claim.opensAt,
                early: claim.claimableAt(beforeReclaim),
                onTime: claim.claimableAt(reclaim),
              })),
              strangerClaims: Option.isSome(entry.claimOf(stranger)),
              linkFromSender: entry.paymentLinkFrom(sender),
              linkFromStranger: entry.paymentLinkFrom(stranger),
            })),
          ).toEqual([
            {
              unclaimedFunds: sponsored,
              asset: usdc,
              amount: 5_500_001n,
              linkClaimsEarly: true,
              senderClaims: Option.some({
                opensAt: Option.some(reclaim),
                early: false,
                onTime: true,
              }),
              strangerClaims: false,
              linkFromSender: Option.some(link),
              linkFromStranger: Option.none(),
            },
          ]);

          const fromSender = yield* reads.unclaimedFundsFrom(sender);

          expect(
            Arr.sortWith(
              fromSender.map((entry) => ({
                id: entry.unclaimedFunds,
                paymentLink: entry.paymentLinkFrom(sender),
              })),
              (entry) => entry.id,
              Order.String,
            ),
          ).toEqual(
            Arr.sortWith(
              [
                { id: sponsored, paymentLink: Option.some(link) },
                { id: unsponsored, paymentLink: Option.none() },
              ],
              (entry) => entry.id,
              Order.String,
            ),
          );
        }),
    );
  },
);
