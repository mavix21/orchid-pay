import { Networks } from "@stellar/stellar-sdk";
import { baseAsset } from "../contract";
import { toStellarAsset } from "./assets";

export const networkPassphrase = Networks.TESTNET;

export const network = "testnet";

export const testnetReset = Date.UTC(2026, 11, 16);

export function epochAt(time: number): string {
  return time < testnetReset ? "before-2026-12-16" : "2026-12-16";
}

export const usdc = toStellarAsset(baseAsset);

export const depositContract = usdc.contractId(networkPassphrase);

export const baseReserve = 5_000_000n;

export const baseFee = "100";
