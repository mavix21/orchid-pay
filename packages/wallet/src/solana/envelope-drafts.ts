import {
  getCreateAssociatedTokenIdempotentInstruction,
  getSetAuthorityInstruction,
  getTransferCheckedInstruction,
  AuthorityType,
} from "@solana-program/token";
import {
  AccountRole,
  type Address,
  type Blockhash,
  type Instruction,
  type ReadonlyUint8Array,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import {
  USDC_MINT_ADDRESS,
  buildClaimInstruction,
  buildCreateInstruction,
  buildReclaimInstruction,
} from "@workspace/orchid-links";
import type { PositiveAmount, UnsignedEnvelope } from "../contract";
import { encodeEnvelope } from "./envelope-codec";
import { type TextMemo, memoInstructions } from "./memo";
import {
  unclaimedFundsAddressOf,
  usdcAccountOf,
  vaultAddressOf,
} from "./program-addresses";
import { solanaProfile } from "./profile";

export interface DraftWindow {
  readonly blockhash: Blockhash;
  readonly lastValidBlockHeight: bigint;
  readonly draftedSlot: bigint;
  readonly computeUnitPrice: bigint;
}

export interface Drafting extends DraftWindow {
  readonly sponsor: Address;
}

export interface OpeningInput extends Drafting {
  readonly address: Address;
}

export interface PaymentInput extends Drafting {
  readonly from: Address;
  readonly destinationTokenAccount: Address;
  readonly amount: PositiveAmount;
  readonly memo?: TextMemo | undefined;
}

export interface PaymentLinkInput extends Drafting {
  readonly from: Address;
  readonly link: Address;
  readonly orderId: ReadonlyUint8Array;
  readonly amount: PositiveAmount;
}

export interface LinkReceiveInput extends Drafting {
  readonly link: Address;
  readonly unclaimedFunds: Address;
  readonly destinationTokenAccount: Address;
  readonly memo?: TextMemo | undefined;
}

export interface ExternalPaymentInput extends DraftWindow {
  readonly payer: Address;
  readonly reference: Address;
  readonly destinationTokenAccount: Address;
  readonly amount: PositiveAmount;
  readonly memo: TextMemo;
}

export interface ReclaimInput extends Drafting {
  readonly address: Address;
  readonly unclaimedFunds: Address;
}

export const computeUnitLimits = {
  opening: 80_000,
  payment: 60_000,
  paymentLink: 150_000,
  linkReceive: 100_000,
  reclaim: 80_000,
};

const draft = (
  feePayer: Address,
  drafting: DraftWindow,
  computeUnitLimit: number,
  instructions: ReadonlyArray<Instruction>,
): UnsignedEnvelope => {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (current) => setTransactionMessageFeePayer(feePayer, current),
    (current) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: drafting.blockhash,
          lastValidBlockHeight: drafting.lastValidBlockHeight,
        },
        current,
      ),
    (current) =>
      setTransactionMessageComputeUnitLimit(computeUnitLimit, current),
    (current) =>
      setTransactionMessageComputeUnitPrice(drafting.computeUnitPrice, current),
    (current) => appendTransactionMessageInstructions(instructions, current),
  );

  return encodeEnvelope({
    lastValidBlockHeight: drafting.lastValidBlockHeight,
    draftedSlot: drafting.draftedSlot,
    messageBytes: compileTransaction(message).messageBytes,
  });
};

export const draftOpening = (input: OpeningInput) => {
  const account = usdcAccountOf(input.address);

  return draft(input.sponsor, input, computeUnitLimits.opening, [
    getCreateAssociatedTokenIdempotentInstruction({
      payer: createNoopSigner(input.sponsor),
      ata: account,
      owner: input.address,
      mint: USDC_MINT_ADDRESS,
    }),
    getSetAuthorityInstruction({
      owned: account,
      owner: createNoopSigner(input.address),
      authorityType: AuthorityType.CloseAccount,
      newAuthority: input.sponsor,
    }),
  ]);
};

export const draftPayment = (input: PaymentInput) =>
  draft(input.sponsor, input, computeUnitLimits.payment, [
    ...memoInstructions(input.memo),
    getTransferCheckedInstruction({
      source: usdcAccountOf(input.from),
      mint: USDC_MINT_ADDRESS,
      destination: input.destinationTokenAccount,
      authority: createNoopSigner(input.from),
      amount: input.amount,
      decimals: solanaProfile.precisionOf(USDC_MINT_ADDRESS).decimals,
    }),
  ]);

export const draftExternalPayment = (input: ExternalPaymentInput) => {
  const transfer = getTransferCheckedInstruction({
    source: usdcAccountOf(input.payer),
    mint: USDC_MINT_ADDRESS,
    destination: input.destinationTokenAccount,
    authority: createNoopSigner(input.payer),
    amount: input.amount,
    decimals: solanaProfile.precisionOf(USDC_MINT_ADDRESS).decimals,
  });

  return draft(input.payer, input, computeUnitLimits.payment, [
    ...memoInstructions(input.memo),
    {
      ...transfer,
      accounts: [
        ...transfer.accounts,
        { address: input.reference, role: AccountRole.READONLY_SIGNER },
      ],
    },
  ]);
};

export const draftPaymentLink = (input: PaymentLinkInput) => {
  const unclaimedFunds = unclaimedFundsAddressOf(
    input.from,
    input.link,
    input.orderId,
  );

  return draft(input.sponsor, input, computeUnitLimits.paymentLink, [
    buildCreateInstruction({
      sender: input.from,
      rentRecipient: input.sponsor,
      source: usdcAccountOf(input.from),
      link: input.link,
      orderId: input.orderId,
      amount: input.amount,
      unclaimedFunds,
      vault: vaultAddressOf(unclaimedFunds),
    }),
  ]);
};

export const draftLinkReceive = (input: LinkReceiveInput) =>
  draft(input.sponsor, input, computeUnitLimits.linkReceive, [
    ...memoInstructions(input.memo),
    buildClaimInstruction({
      signer: input.link,
      unclaimedFunds: input.unclaimedFunds,
      vault: vaultAddressOf(input.unclaimedFunds),
      destination: input.destinationTokenAccount,
      rentRecipient: input.sponsor,
    }),
  ]);

export const draftReclaim = (input: ReclaimInput) =>
  draft(input.sponsor, input, computeUnitLimits.reclaim, [
    buildReclaimInstruction({
      signer: input.address,
      unclaimedFunds: input.unclaimedFunds,
      vault: vaultAddressOf(input.unclaimedFunds),
      destination: usdcAccountOf(input.address),
      rentRecipient: input.sponsor,
    }),
  ]);
