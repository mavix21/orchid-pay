import { network } from "@workspace/wallet";

export const explorerAddressUrl = (address: string) =>
  `https://explorer.solana.com/address/${address}?cluster=${network}`;

export const explorerTransactionUrl = (hash: string) =>
  `https://explorer.solana.com/tx/${hash}?cluster=${network}`;
