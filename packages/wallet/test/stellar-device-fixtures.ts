import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58 } from "@scure/base";
import { mnemonicToSeedSync } from "@scure/bip39";
import { Account, Keypair, MuxedAccount } from "@stellar/stellar-sdk";
import * as Schema from "effect/Schema";
import { HDKey } from "micro-key-producer/slip10.js";
import {
  type AccountAddress,
  type Asset,
  DestinationAddress,
  type PaymentMemo,
  type PositiveAmount,
  Profile,
  Username,
  baseAsset,
} from "../src/contract";
import type { SecretPhrase } from "../src/device/secret-phrase";
import { type LinkCode, generateLinkCode } from "../src/device/link-code";
import {
  draftClaimable,
  draftPaymentLink,
} from "../src/stellar/asset-envelopes";
import { draftPayment } from "../src/stellar/envelopes";
import { networkPassphrase } from "../src/stellar/network";
import { stellarSigningScheme } from "../src/stellar/signing-scheme";
import {
  DeviceWallet,
  knownPhrase,
  nowSeconds,
  signingKey,
} from "./device-fixtures";
import { addressOf } from "./test-keys";

export const linkKeypairOf = (code: LinkCode) =>
  Keypair.fromRawEd25519Seed(
    Buffer.from(
      hkdf(
        sha256,
        base58.decode(code).slice(1, 17),
        new TextEncoder().encode("orchid-payment-link-code-v1"),
        new TextEncoder().encode(networkPassphrase),
        32,
      ),
    ),
  );

export const linkFixture = () => {
  const code = generateLinkCode();

  return { code, keypair: linkKeypairOf(code) };
};

export const stellarSigningKey = (phrase: SecretPhrase) =>
  Keypair.fromRawEd25519Seed(
    HDKey.fromMasterSeed(mnemonicToSeedSync(phrase)).derive(
      stellarSigningScheme.derivationPath,
    ).privateKey,
  );

export const seededDeviceWallet = (
  reserveSponsor = addressOf(Keypair.random()),
) =>
  new DeviceWallet({
    phrase: knownPhrase,
    address: addressOf(signingKey(knownPhrase)),
    username: Schema.decodeSync(Username)("maria"),
    reserveSponsor,
    backup: "stored",
  });

export const sendActors = () => {
  const sponsor = addressOf(Keypair.random());
  const wallet = seededDeviceWallet(sponsor);
  const exchange = addressOf(Keypair.random());
  const pedro = addressOf(Keypair.random());
  const stranger = addressOf(Keypair.random());

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
    muxed: (id: string) =>
      Schema.decodeSync(DestinationAddress)(
        new MuxedAccount(new Account(exchange, "0"), id).accountId(),
      ),
    payment: (opts: {
      readonly source?: AccountAddress;
      readonly to: DestinationAddress;
      readonly amount: PositiveAmount;
      readonly asset?: Asset;
      readonly memo?: PaymentMemo;
      readonly sequence?: string;
      readonly lifetime?: number;
      readonly at?: number;
    }) => {
      const at = opts.at ?? nowSeconds();

      return draftPayment({
        source: new Account(
          opts.source ?? wallet.address,
          opts.sequence ?? "100",
        ),
        to: opts.to,
        asset: opts.asset ?? baseAsset,
        amount: opts.amount,
        memo: opts.memo,
        minTime: at,
        maxTime: at + (opts.lifetime ?? 120),
      });
    },
    claimable: (opts: {
      readonly to: AccountAddress;
      readonly amount: PositiveAmount;
      readonly reserveSponsor?: AccountAddress;
    }) => {
      const at = nowSeconds();

      return draftClaimable({
        source: new Account(wallet.address, "100"),
        reserveSponsor: opts.reserveSponsor ?? sponsor,
        to: opts.to,
        asset: baseAsset,
        amount: opts.amount,
        minTime: at,
        maxTime: at + 120,
      });
    },
    paymentLink: (opts: {
      readonly source?: AccountAddress;
      readonly to: AccountAddress;
      readonly asset?: Asset;
      readonly amount: PositiveAmount;
      readonly reserveSponsor?: AccountAddress;
      readonly sequence?: string;
      readonly lifetime?: number;
      readonly at?: number;
    }) => {
      const at = opts.at ?? nowSeconds();

      return draftPaymentLink({
        source: new Account(
          opts.source ?? wallet.address,
          opts.sequence ?? "100",
        ),
        reserveSponsor: opts.reserveSponsor ?? sponsor,
        to: opts.to,
        asset: opts.asset ?? baseAsset,
        amount: opts.amount,
        minTime: at,
        maxTime: at + (opts.lifetime ?? 120),
      });
    },
  };
};
