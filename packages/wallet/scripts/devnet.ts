import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token";
import {
  type Address,
  type Signature,
  address,
  appendTransactionMessageInstruction,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import { USDC_MINT_ADDRESS } from "@workspace/orchid-links";
import * as Redacted from "effect/Redacted";
import { usdcAccountOf } from "../src/solana/program-addresses";
import {
  solanaSandboxDepositAddress,
  sponsorKeypairOf,
} from "../src/solana/sponsor-keys.server";

export const publicDevnetRpcUrl = "https://api.devnet.solana.com";

const confirmationAttempts = 60;

const confirmationPause = 1_000;

const pause = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const newSponsorSecret = () => {
  const seed = ed25519.utils.randomSecretKey();
  const keypair = new Uint8Array([...seed, ...ed25519.getPublicKey(seed)]);

  return base58.encode(keypair);
};

export const sponsorAddressOf = (sponsorSecret: string) =>
  address(
    base58.encode(sponsorKeypairOf(Redacted.make(sponsorSecret)).slice(32)),
  );

export const sandboxPartnerOf = (sponsorSecret: string) =>
  solanaSandboxDepositAddress({ sponsorSecret: Redacted.make(sponsorSecret) });

const confirmed = async (rpcUrl: string, signature: Signature) => {
  const rpc = createSolanaRpc(rpcUrl);

  for (let attempt = 0; attempt < confirmationAttempts; attempt += 1) {
    const {
      value: [status],
    } = await rpc.getSignatureStatuses([signature]).send();

    if (status?.err) throw new Error(`Transaction ${signature} failed`);

    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    )
      return;

    await pause(confirmationPause);
  }

  throw new Error(`Transaction ${signature} was not confirmed`);
};

export const airdrop = async (rpcUrl: string, recipient: Address) => {
  const signature = await createSolanaRpc(rpcUrl)
    .requestAirdrop(recipient, lamports(1_000_000_000n))
    .send();

  await confirmed(rpcUrl, signature);
};

export const hasUsdcAccount = async (rpcUrl: string, owner: Address) => {
  const { value } = await createSolanaRpc(rpcUrl)
    .getAccountInfo(usdcAccountOf(owner), { encoding: "base64" })
    .send();

  return value !== null;
};

export const openSandboxPartner = async (
  rpcUrl: string,
  sponsorSecret: string,
) => {
  const partner = address(sandboxPartnerOf(sponsorSecret));

  if (await hasUsdcAccount(rpcUrl, partner)) return false;

  const rpc = createSolanaRpc(rpcUrl);

  const sponsor = await createKeyPairSignerFromBytes(
    sponsorKeypairOf(Redacted.make(sponsorSecret)),
  );

  const { value: latest } = await rpc.getLatestBlockhash().send();

  const transaction = await signTransactionMessageWithSigners(
    pipe(
      createTransactionMessage({ version: 0 }),
      (message) => setTransactionMessageFeePayerSigner(sponsor, message),
      (message) => setTransactionMessageLifetimeUsingBlockhash(latest, message),
      (message) =>
        appendTransactionMessageInstruction(
          getCreateAssociatedTokenIdempotentInstruction({
            payer: sponsor,
            ata: usdcAccountOf(partner),
            owner: partner,
            mint: USDC_MINT_ADDRESS,
          }),
          message,
        ),
    ),
  );

  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: "base64",
    })
    .send();
  await confirmed(rpcUrl, getSignatureFromTransaction(transaction));

  return true;
};
