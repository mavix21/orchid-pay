import { address } from "@solana/kit";

import type {
  ORCHID_LINKS_ERROR__CLOCK_OVERFLOW,
  ORCHID_LINKS_ERROR__DESTINATION_IS_VAULT,
  ORCHID_LINKS_ERROR__LINK_IS_SENDER,
  ORCHID_LINKS_ERROR__NOT_YET_RECLAIMABLE,
  ORCHID_LINKS_ERROR__WRONG_RENT_RECIPIENT,
  ORCHID_LINKS_ERROR__WRONG_SIGNER,
  ORCHID_LINKS_ERROR__ZERO_AMOUNT,
} from "./generated/errors";

export { ORCHID_LINKS_PROGRAM_ADDRESS } from "./generated/programs";

export const USDC_MINT_ADDRESS = address(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

export const TOKEN_PROGRAM_ADDRESS = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export const SYSTEM_PROGRAM_ADDRESS = address(
  "11111111111111111111111111111111",
);

export const RECLAIM_DELAY_SECONDS = 0n;

export const orchidLinksErrorCode = {
  zeroAmount: 6000,
  linkIsSender: 6001,
  notYetReclaimable: 6002,
  wrongSigner: 6003,
  wrongRentRecipient: 6004,
  destinationIsVault: 6005,
  clockOverflow: 6006,
} as const satisfies {
  readonly zeroAmount: typeof ORCHID_LINKS_ERROR__ZERO_AMOUNT;
  readonly linkIsSender: typeof ORCHID_LINKS_ERROR__LINK_IS_SENDER;
  readonly notYetReclaimable: typeof ORCHID_LINKS_ERROR__NOT_YET_RECLAIMABLE;
  readonly wrongSigner: typeof ORCHID_LINKS_ERROR__WRONG_SIGNER;
  readonly wrongRentRecipient: typeof ORCHID_LINKS_ERROR__WRONG_RENT_RECIPIENT;
  readonly destinationIsVault: typeof ORCHID_LINKS_ERROR__DESTINATION_IS_VAULT;
  readonly clockOverflow: typeof ORCHID_LINKS_ERROR__CLOCK_OVERFLOW;
};
