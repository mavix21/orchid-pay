import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { type Address, address, blockhash } from "@solana/kit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  type DestinationAddress,
  type PaymentMemo,
  type PositiveAmount,
  Profile,
  type UnclaimedFundsId,
  Username,
} from "../src/contract";
import {
  type LinkCode,
  generateLinkCode,
  linkAddressOf,
} from "../src/device/link-code";
import {
  type Drafting,
  draftLinkReceive,
  draftOpening,
  draftPayment,
  draftPaymentLink,
  draftReclaim,
} from "../src/solana/envelope-drafts";
import { textMemoOf } from "../src/solana/memo";
import { chainId } from "../src/solana/network";
import { usdcAccountOf } from "../src/solana/program-addresses";
import { DeviceWallet, knownPhrase, signingKey } from "./device-fixtures";
import { addressOf, randomAddress } from "./test-keys";

export const draftingBy = (sponsor: AccountAddress, slot = 100n): Drafting => ({
  sponsor: address(sponsor),
  blockhash: blockhash("EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"),
  lastValidBlockHeight: slot + 150n,
  draftedSlot: slot,
  computeUnitPrice: 1_000n,
});

const orderIdOf = (slot: bigint) => {
  const orderId = new Uint8Array(16);

  new DataView(orderId.buffer).setBigUint64(0, slot);

  return orderId;
};

export const linkFixture = () => {
  const code = generateLinkCode();

  return { code, link: linkAddressOfCode(code) };
};

export const linkSeedOf = (code: LinkCode) =>
  hkdf(
    sha256,
    base58.decode(code).slice(1, 17),
    new TextEncoder().encode("orchid-payment-link-code-v1"),
    new TextEncoder().encode(chainId),
    32,
  );

export const linkAddressOfCode = (code: LinkCode) =>
  Option.getOrThrow(linkAddressOf(code));

export const seededDeviceWallet = (reserveSponsor = randomAddress()) =>
  new DeviceWallet({
    phrase: knownPhrase,
    address: addressOf(signingKey(knownPhrase)),
    username: Schema.decodeSync(Username)("maria"),
    reserveSponsor,
    backup: "stored",
  });

const addressOfAccount = (account: AccountAddress | DestinationAddress) =>
  address(account);

export const solanaDrafts = (sponsor: AccountAddress) => ({
  opening: (owner: AccountAddress, slot = 100n) =>
    draftOpening({ ...draftingBy(sponsor, slot), address: address(owner) }),
  payment: (opts: {
    readonly from: AccountAddress;
    readonly to: DestinationAddress;
    readonly amount: PositiveAmount;
    readonly memo?: PaymentMemo;
    readonly slot?: bigint;
    readonly creditedAccount?: Address;
  }) =>
    draftPayment({
      ...draftingBy(sponsor, opts.slot),
      from: address(opts.from),
      destinationTokenAccount:
        opts.creditedAccount ?? usdcAccountOf(addressOfAccount(opts.to)),
      amount: opts.amount,
      memo: textMemoOf(opts.memo),
    }),
  paymentLink: (opts: {
    readonly from: AccountAddress;
    readonly to: AccountAddress;
    readonly amount: PositiveAmount;
    readonly slot?: bigint;
  }) =>
    draftPaymentLink({
      ...draftingBy(sponsor, opts.slot),
      from: address(opts.from),
      link: address(opts.to),
      orderId: orderIdOf(opts.slot ?? 100n),
      amount: opts.amount,
    }),
  linkReceive: (opts: {
    readonly link: AccountAddress;
    readonly unclaimedFunds: UnclaimedFundsId;
    readonly destination: DestinationAddress;
    readonly memo?: PaymentMemo;
    readonly creditedAccount?: Address;
  }) =>
    draftLinkReceive({
      ...draftingBy(sponsor),
      link: address(opts.link),
      unclaimedFunds: address(opts.unclaimedFunds),
      destinationTokenAccount:
        opts.creditedAccount ??
        usdcAccountOf(addressOfAccount(opts.destination)),
      memo: textMemoOf(opts.memo),
    }),
  reclaim: (owner: AccountAddress, unclaimedFunds: UnclaimedFundsId) =>
    draftReclaim({
      ...draftingBy(sponsor),
      address: address(owner),
      unclaimedFunds: address(unclaimedFunds),
    }),
});

export const sendActors = () => {
  const sponsor = randomAddress();
  const wallet = seededDeviceWallet(sponsor);
  const exchange = randomAddress();
  const pedro = randomAddress();
  const stranger = randomAddress();
  const drafts = solanaDrafts(sponsor);

  const pedroProfile = new Profile({
    username: Schema.decodeSync(Username)("pedro"),
    address: pedro,
  });

  return {
    wallet,
    sender: wallet.address,
    sponsor,
    exchange,
    pedro,
    stranger,
    pedroProfile,
    drafts,
    payment: (opts: {
      readonly source?: AccountAddress;
      readonly to: DestinationAddress;
      readonly amount: PositiveAmount;
      readonly memo?: PaymentMemo;
      readonly slot?: bigint;
    }) => drafts.payment({ ...opts, from: opts.source ?? wallet.address }),
    paymentLink: (opts: {
      readonly source?: AccountAddress;
      readonly to: AccountAddress;
      readonly amount: PositiveAmount;
      readonly slot?: bigint;
    }) => drafts.paymentLink({ ...opts, from: opts.source ?? wallet.address }),
  };
};
