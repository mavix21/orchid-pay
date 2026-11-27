import {
  type Amount,
  type Asset,
  formatAmount,
  precisionOf,
} from "@workspace/wallet";

export const amountLabel = (amount: Amount, asset: Asset) =>
  `${formatAmount(amount, precisionOf(asset))} ${asset.code}`;

export const shortAddress = (address: string) =>
  `${address.slice(0, 4)}…${address.slice(-4)}`;
