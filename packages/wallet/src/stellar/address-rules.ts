import { base32nopad } from "@scure/base";
import * as Option from "effect/Option";
import type { AddressRules } from "../address-rules";

const account = { pattern: /^G[A-Z2-7]{55}$/u, version: 6 << 3 };

const muxedAccount = { pattern: /^M[A-Z2-7]{68}$/u, version: 12 << 3 };

const claimableBalanceIdPattern = /^00000000[0-9a-f]{64}$/u;

const isAccountAddress = (text: string) => account.pattern.test(text);

export const isMuxedAddress = (text: string) => muxedAccount.pattern.test(text);

const decodeBase32 = Option.liftThrowable(base32nopad.decode);

const crc16 = (bytes: Uint8Array) =>
  bytes.reduce((checksum, byte) => {
    let next = checksum ^ (byte << 8);

    for (let bit = 0; bit < 8; bit++)
      next = next & 0x8000 ? (next << 1) ^ 0x1021 : next << 1;

    return next & 0xffff;
  }, 0);

const hasValidChecksum = (text: string) =>
  [account, muxedAccount].some(
    ({ pattern, version }) =>
      pattern.test(text) &&
      Option.exists(decodeBase32(text), (bytes) => {
        const [low = 0, high = 0] = bytes.subarray(-2);

        return (
          bytes[0] === version &&
          crc16(bytes.subarray(0, -2)) === (low | (high << 8))
        );
      }),
  );

export const stellarAddressRules: AddressRules = {
  isAccountAddress,
  isDestinationAddress: (text) =>
    isAccountAddress(text) || isMuxedAddress(text),
  forbidsMemo: isMuxedAddress,
  isUnclaimedFundsId: (text) => claimableBalanceIdPattern.test(text),
  hasValidChecksum,
};
