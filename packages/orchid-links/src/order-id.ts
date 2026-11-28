import type { ReadonlyUint8Array } from "@solana/kit";

export const ORDER_ID_SIZE = 16;

export const requireOrderId = (orderId: ReadonlyUint8Array) => {
  if (orderId.length !== ORDER_ID_SIZE) {
    throw new RangeError(
      `An order id has ${ORDER_ID_SIZE} bytes, not ${orderId.length}`,
    );
  }

  return orderId;
};
