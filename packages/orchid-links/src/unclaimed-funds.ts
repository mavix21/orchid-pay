import {
  fixDecoderSize,
  fixEncoderSize,
  getAddressDecoder,
  getAddressEncoder,
  getBytesDecoder,
  getBytesEncoder,
  getI64Decoder,
  getProgramDerivedAddress,
  getStructDecoder,
  getU64Decoder,
  getU8Decoder,
  getUtf8Encoder,
  transformEncoder,
  type Address,
  type ProgramDerivedAddress,
  type ReadonlyUint8Array,
} from "@solana/kit";

import { ORCHID_LINKS_PROGRAM_ADDRESS } from "./program";

export const UNCLAIMED_FUNDS_DISCRIMINATOR = new Uint8Array([
  34, 12, 96, 75, 126, 67, 184, 60,
]);

export const UNCLAIMED_FUNDS_SENDER_OFFSET = 8;
export const UNCLAIMED_FUNDS_LINK_OFFSET = 40;
export const UNCLAIMED_FUNDS_SIZE = 153;

export const ORDER_ID_SIZE = 16;

export type UnclaimedFunds = {
  readonly sender: Address;
  readonly link: Address;
  readonly mint: Address;
  readonly rentRecipient: Address;
  readonly amount: bigint;
  readonly reclaimableAt: bigint;
  readonly bump: number;
};

export const getUnclaimedFundsDecoder = () =>
  getStructDecoder([
    ["discriminator", fixDecoderSize(getBytesDecoder(), 8)],
    ["sender", getAddressDecoder()],
    ["link", getAddressDecoder()],
    ["mint", getAddressDecoder()],
    ["rentRecipient", getAddressDecoder()],
    ["amount", getU64Decoder()],
    ["reclaimableAt", getI64Decoder()],
    ["bump", getU8Decoder()],
  ]);

export const decodeUnclaimedFunds = (
  data: ReadonlyUint8Array,
): UnclaimedFunds | null => {
  if (data.length !== UNCLAIMED_FUNDS_SIZE) return null;

  const { discriminator, ...unclaimedFunds } =
    getUnclaimedFundsDecoder().decode(data);

  return discriminator.every(
    (byte, index) => byte === UNCLAIMED_FUNDS_DISCRIMINATOR[index],
  )
    ? unclaimedFunds
    : null;
};

export const getOrderIdEncoder = () =>
  transformEncoder(
    fixEncoderSize(getBytesEncoder(), ORDER_ID_SIZE),
    (orderId: ReadonlyUint8Array) => {
      if (orderId.length !== ORDER_ID_SIZE) {
        throw new RangeError(
          `An order id has ${ORDER_ID_SIZE} bytes, not ${orderId.length}`,
        );
      }

      return orderId;
    },
  );

export const findUnclaimedFundsAddress = async (
  sender: Address,
  link: Address,
  orderId: ReadonlyUint8Array,
): Promise<ProgramDerivedAddress> =>
  getProgramDerivedAddress({
    programAddress: ORCHID_LINKS_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("link"),
      getAddressEncoder().encode(sender),
      getAddressEncoder().encode(link),
      getOrderIdEncoder().encode(orderId),
    ],
  });

export const findVaultAddress = (
  unclaimedFunds: Address,
): Promise<ProgramDerivedAddress> =>
  getProgramDerivedAddress({
    programAddress: ORCHID_LINKS_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode("vault"),
      getAddressEncoder().encode(unclaimedFunds),
    ],
  });
