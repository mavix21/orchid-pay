import { address } from "@solana/kit";

export const ORCHID_LINKS_PROGRAM_ADDRESS = address(
  "GAgsxe3vwNSSFcsaMViggfk37wBaj7yioYaXFYa7Cv6M",
);

export const USDC_MINT_ADDRESS = address(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

export const TOKEN_PROGRAM_ADDRESS = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export const SYSTEM_PROGRAM_ADDRESS = address(
  "11111111111111111111111111111111",
);

export const RECLAIM_DELAY_SECONDS = 7n * 24n * 60n * 60n;

export const orchidLinksErrorCode = {
  zeroAmount: 6000,
  linkIsSender: 6001,
  notYetReclaimable: 6002,
  wrongSigner: 6003,
  wrongRentRecipient: 6004,
  destinationIsVault: 6005,
  clockOverflow: 6006,
} as const;
