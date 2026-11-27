import { Keypair } from "@stellar/stellar-sdk";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { channelKeypair } from "../src/stellar/channel-pool.server";
import { WalletSettings } from "../src/server/settings.server";
import { passkeyOrigin } from "./ledger-world";
import { addressOf } from "./test-keys";

export const sponsor = Keypair.random();
export const feePayer = Keypair.random();
export const reserveSponsor = addressOf(sponsor);
export const channel = addressOf(channelKeypair(feePayer, 0));

export const settingsFor = (rpcUrl = "https://soroban-testnet.stellar.org") =>
  Layer.succeed(WalletSettings, {
    rpcUrl,
    reserveSponsorSecret: Redacted.make(sponsor.secret()),
    feePayerSecret: Redacted.make(feePayer.secret()),
    passkeyOrigins: [passkeyOrigin],
    humanCheckSecret: Redacted.make("human-check-secret"),
    sessionSecret: Redacted.make("session-secret"),
  });
