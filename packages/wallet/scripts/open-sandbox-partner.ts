import {
  openSandboxPartner,
  publicDevnetRpcUrl,
  sandboxPartnerOf,
  sponsorAddressOf,
} from "./devnet";

const sponsorSecret = process.env.SPONSOR_SECRET;
const rpcUrl = process.env.SOLANA_RPC_URL ?? publicDevnetRpcUrl;

if (sponsorSecret === undefined) throw new Error("Set SPONSOR_SECRET.");

console.log(`Sponsor: ${sponsorAddressOf(sponsorSecret)}`);

console.log(`Sandbox payout partner: ${sandboxPartnerOf(sponsorSecret)}`);

console.log(
  (await openSandboxPartner(rpcUrl, sponsorSecret))
    ? "Opened the sandbox payout partner's USDC account."
    : "The sandbox payout partner's USDC account is already open.",
);
