import {
  containsBytes,
  fixEncoderSize,
  getAddressEncoder,
  getBytesEncoder,
  getUtf8Encoder,
  transformEncoder,
  type Address,
  type ProgramDerivedAddress,
  type ReadonlyUint8Array,
} from "@solana/kit";

import {
  findUnclaimedFundsPda,
  findVaultPda,
  getUnclaimedFundsDecoder,
  getUnclaimedFundsSize,
  UNCLAIMED_FUNDS_DISCRIMINATOR,
  type UnclaimedFunds as UnclaimedFundsAccount,
} from "./generated";
import { ORDER_ID_SIZE, requireOrderId } from "./order-id";

export { ORDER_ID_SIZE } from "./order-id";

export {
  getUnclaimedFundsDecoder,
  UNCLAIMED_FUNDS_DISCRIMINATOR,
} from "./generated";

export const UNCLAIMED_FUNDS_SENDER_OFFSET = 8;
export const UNCLAIMED_FUNDS_LINK_OFFSET = 40;
export const UNCLAIMED_FUNDS_SIZE = getUnclaimedFundsSize();

export type UnclaimedFunds = Readonly<
  Omit<UnclaimedFundsAccount, "discriminator">
>;

export const decodeUnclaimedFunds = (
  data: ReadonlyUint8Array,
): UnclaimedFunds | null => {
  if (
    data.length !== UNCLAIMED_FUNDS_SIZE ||
    !containsBytes(data, UNCLAIMED_FUNDS_DISCRIMINATOR, 0)
  ) {
    return null;
  }

  const { discriminator: _discriminator, ...unclaimedFunds } =
    getUnclaimedFundsDecoder().decode(data);

  return unclaimedFunds;
};

export const getOrderIdEncoder = () =>
  transformEncoder(
    fixEncoderSize(getBytesEncoder(), ORDER_ID_SIZE),
    requireOrderId,
  );

export const getUnclaimedFundsSeeds = (
  sender: Address,
  link: Address,
  orderId: ReadonlyUint8Array,
): ReadonlyUint8Array[] => [
  getUtf8Encoder().encode("link"),
  getAddressEncoder().encode(sender),
  getAddressEncoder().encode(link),
  getOrderIdEncoder().encode(orderId),
];

export const getVaultSeeds = (
  unclaimedFunds: Address,
): ReadonlyUint8Array[] => [
  getUtf8Encoder().encode("vault"),
  getAddressEncoder().encode(unclaimedFunds),
];

export const findUnclaimedFundsAddress = async (
  sender: Address,
  link: Address,
  orderId: ReadonlyUint8Array,
): Promise<ProgramDerivedAddress> =>
  findUnclaimedFundsPda({ sender, link, orderId: requireOrderId(orderId) });

export const findVaultAddress = (
  unclaimedFunds: Address,
): Promise<ProgramDerivedAddress> => findVaultPda({ unclaimedFunds });
