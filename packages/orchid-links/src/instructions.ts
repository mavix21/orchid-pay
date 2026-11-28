import {
  createNoopSigner,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
} from "@solana/kit";

import {
  getClaimInstruction as getGeneratedClaimInstruction,
  getClaimInstructionAsync,
  getCreateInstruction as getGeneratedCreateInstruction,
  getCreateInstructionAsync,
  getReclaimInstruction as getGeneratedReclaimInstruction,
  getReclaimInstructionAsync,
} from "./generated";
import { requireOrderId } from "./order-id";

export { getCreateInstructionDataDecoder } from "./generated";

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

export type CreateUnclaimedFundsAccounts = {
  readonly unclaimedFunds: Address;
  readonly vault: Address;
};

type ReleaseUnclaimedFundsAccounts = ReleaseUnclaimedFundsInput & {
  readonly vault: Address;
};

const createArgumentsOf = (input: CreateUnclaimedFundsInput) => ({
  sender: createNoopSigner(input.sender),
  rentRecipient: createNoopSigner(input.rentRecipient),
  source: input.source,
  orderId: requireOrderId(input.orderId),
  link: input.link,
  amount: input.amount,
});

export const buildCreateInstruction = (
  input: CreateUnclaimedFundsInput & CreateUnclaimedFundsAccounts,
): Instruction =>
  getGeneratedCreateInstruction({
    ...createArgumentsOf(input),
    unclaimedFunds: input.unclaimedFunds,
    vault: input.vault,
  });

export const getCreateInstruction = async (
  input: CreateUnclaimedFundsInput,
): Promise<Instruction> => getCreateInstructionAsync(createArgumentsOf(input));

const releaseAccountsOf = (input: ReleaseUnclaimedFundsInput) => ({
  unclaimedFunds: input.unclaimedFunds,
  destination: input.destination,
  rentRecipient: input.rentRecipient,
});

export const buildClaimInstruction = (
  input: ReleaseUnclaimedFundsAccounts,
): Instruction =>
  getGeneratedClaimInstruction({
    ...releaseAccountsOf(input),
    link: createNoopSigner(input.signer),
    vault: input.vault,
  });

export const buildReclaimInstruction = (
  input: ReleaseUnclaimedFundsAccounts,
): Instruction =>
  getGeneratedReclaimInstruction({
    ...releaseAccountsOf(input),
    sender: createNoopSigner(input.signer),
    vault: input.vault,
  });

export const getClaimInstruction = async (
  input: ReleaseUnclaimedFundsInput,
): Promise<Instruction> =>
  getClaimInstructionAsync({
    ...releaseAccountsOf(input),
    link: createNoopSigner(input.signer),
  });

export const getReclaimInstruction = async (
  input: ReleaseUnclaimedFundsInput,
): Promise<Instruction> =>
  getReclaimInstructionAsync({
    ...releaseAccountsOf(input),
    sender: createNoopSigner(input.signer),
  });
