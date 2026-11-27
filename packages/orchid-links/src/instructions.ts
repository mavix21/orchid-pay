import {
  AccountRole,
  getAddressEncoder,
  getStructEncoder,
  getU64Encoder,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
} from "@solana/kit";

import {
  ORCHID_LINKS_PROGRAM_ADDRESS,
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  USDC_MINT_ADDRESS,
} from "./program";
import {
  findUnclaimedFundsAddress,
  findVaultAddress,
  getOrderIdEncoder,
} from "./unclaimed-funds";

const CREATE_DISCRIMINATOR = new Uint8Array([24, 30, 200, 40, 5, 28, 7, 119]);

const CLAIM_DISCRIMINATOR = new Uint8Array([
  62, 198, 214, 193, 213, 159, 108, 210,
]);

const RECLAIM_DISCRIMINATOR = new Uint8Array([
  44, 177, 236, 249, 145, 109, 163, 186,
]);

const getCreateArgumentsEncoder = () =>
  getStructEncoder([
    ["orderId", getOrderIdEncoder()],
    ["link", getAddressEncoder()],
    ["amount", getU64Encoder()],
  ]);

export type CreateUnclaimedFundsInput = {
  readonly sender: Address;
  readonly rentRecipient: Address;
  readonly source: Address;
  readonly link: Address;
  readonly orderId: ReadonlyUint8Array;
  readonly amount: bigint;
};

export type ReleaseUnclaimedFundsInput = {
  readonly signer: Address;
  readonly unclaimedFunds: Address;
  readonly destination: Address;
  readonly rentRecipient: Address;
};

export const getCreateInstruction = async (
  input: CreateUnclaimedFundsInput,
): Promise<Instruction> => {
  const [unclaimedFunds] = await findUnclaimedFundsAddress(
    input.sender,
    input.link,
    input.orderId,
  );

  const [vault] = await findVaultAddress(unclaimedFunds);

  return {
    programAddress: ORCHID_LINKS_PROGRAM_ADDRESS,
    accounts: [
      { address: input.sender, role: AccountRole.READONLY_SIGNER },
      { address: input.rentRecipient, role: AccountRole.WRITABLE_SIGNER },
      { address: unclaimedFunds, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.WRITABLE },
      { address: USDC_MINT_ADDRESS, role: AccountRole.READONLY },
      { address: input.source, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([
      ...CREATE_DISCRIMINATOR,
      ...getCreateArgumentsEncoder().encode(input),
    ]),
  };
};

const getReleaseInstruction = async (
  discriminator: Uint8Array,
  input: ReleaseUnclaimedFundsInput,
): Promise<Instruction> => {
  const [vault] = await findVaultAddress(input.unclaimedFunds);

  return {
    programAddress: ORCHID_LINKS_PROGRAM_ADDRESS,
    accounts: [
      { address: input.signer, role: AccountRole.READONLY_SIGNER },
      { address: input.unclaimedFunds, role: AccountRole.WRITABLE },
      { address: vault, role: AccountRole.WRITABLE },
      { address: input.destination, role: AccountRole.WRITABLE },
      { address: input.rentRecipient, role: AccountRole.WRITABLE },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: discriminator,
  };
};

export const getClaimInstruction = (input: ReleaseUnclaimedFundsInput) =>
  getReleaseInstruction(CLAIM_DISCRIMINATOR, input);

export const getReclaimInstruction = (input: ReleaseUnclaimedFundsInput) =>
  getReleaseInstruction(RECLAIM_DISCRIMINATOR, input);
