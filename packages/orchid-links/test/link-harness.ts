import { fileURLToPath } from "node:url";

import {
  AccountState,
  getMintEncoder,
  getTokenDecoder,
  getTokenEncoder,
  getTransferInstruction,
} from "@solana-program/token";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  lamports,
  none,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  some,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import {
  InstructionErrorCustom,
  TransactionErrorInstructionError,
} from "litesvm/dist/internal";

import {
  decodeUnclaimedFunds,
  getCreateInstruction,
  ORCHID_LINKS_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  USDC_MINT_ADDRESS,
  findUnclaimedFundsAddress,
  type UnclaimedFunds,
} from "../src";

export const anchorErrorCode = {
  constraintSeeds: 2006,
  constraintAddress: 2012,
  constraintTokenMint: 2014,
  invalidProgramId: 3008,
  accountNotInitialized: 3012,
} as const;

export const TOKEN_2022_PROGRAM_ADDRESS = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export type TransactionOutcome =
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed"; readonly code: number | null };

const programPath = fileURLToPath(
  new URL("../../../target/deploy/orchid_links.so", import.meta.url),
);

const TOKEN_ACCOUNT_SIZE = 165n;
const MINT_SIZE = 82n;
const FUNDED_LAMPORTS = lamports(10_000_000_000n);

export const createLinkHarness = async () => {
  const svm = new LiteSVM();
  svm.addProgramFromFile(ORCHID_LINKS_PROGRAM_ADDRESS, programPath);

  const usdcAuthority = await generateKeyPairSigner();

  const setMint = (mint: Address, authority: Address) =>
    svm.setAccount({
      address: mint,
      data: getMintEncoder().encode({
        mintAuthority: some(authority),
        supply: 1_000_000_000_000n,
        decimals: 6,
        isInitialized: true,
        freezeAuthority: none(),
      }),
      executable: false,
      lamports: lamports(svm.minimumBalanceForRentExemption(MINT_SIZE)),
      programAddress: TOKEN_PROGRAM_ADDRESS,
      space: MINT_SIZE,
    });

  setMint(USDC_MINT_ADDRESS, usdcAuthority.address);

  const fundedSigner = async () => {
    const signer = await generateKeyPairSigner();
    svm.airdrop(signer.address, FUNDED_LAMPORTS);

    return signer;
  };

  const unfundedSigner = () => generateKeyPairSigner();

  const tokenAccount = async (
    owner: Address,
    amount: bigint,
    mint: Address = USDC_MINT_ADDRESS,
  ) => {
    const { address: account } = await generateKeyPairSigner();
    svm.setAccount({
      address: account,
      data: getTokenEncoder().encode({
        mint,
        owner,
        amount,
        delegate: none(),
        state: AccountState.Initialized,
        isNative: none(),
        delegatedAmount: 0n,
        closeAuthority: none(),
      }),
      executable: false,
      lamports: lamports(
        svm.minimumBalanceForRentExemption(TOKEN_ACCOUNT_SIZE),
      ),
      programAddress: TOKEN_PROGRAM_ADDRESS,
      space: TOKEN_ACCOUNT_SIZE,
    });

    return account;
  };

  const otherMint = async () => {
    const { address: mint } = await generateKeyPairSigner();
    setMint(mint, usdcAuthority.address);

    return mint;
  };

  const send = async (
    feePayer: KeyPairSigner,
    instructions: readonly Instruction[],
    signers: readonly KeyPairSigner[],
  ): Promise<TransactionOutcome> => {
    svm.expireBlockhash();

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (draft) => setTransactionMessageFeePayer(feePayer.address, draft),
      (draft) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: svm.latestBlockhash(), lastValidBlockHeight: 0n },
          draft,
        ),
      (draft) => appendTransactionMessageInstructions(instructions, draft),
    );

    const transaction = await signTransaction(
      [feePayer, ...signers].map((signer) => signer.keyPair),
      compileTransaction(message),
    );

    const result = svm.sendTransaction(transaction);

    if (!(result instanceof FailedTransactionMetadata)) {
      return { kind: "succeeded" };
    }

    const error = result.err();

    const instructionError =
      error instanceof TransactionErrorInstructionError ? error.err() : null;

    return {
      kind: "failed",
      code:
        instructionError instanceof InstructionErrorCustom
          ? instructionError.code
          : null,
    };
  };

  const tokenBalance = (tokenAccountAddress: Address) => {
    const account = svm.getAccount(tokenAccountAddress);

    return account.exists
      ? getTokenDecoder().decode(account.data).amount
      : null;
  };

  const lamportBalance = (account: Address) =>
    svm.getBalance(account) ?? lamports(0n);

  const unclaimedFunds = (
    unclaimedFundsAddress: Address,
  ): UnclaimedFunds | null => {
    const account = svm.getAccount(unclaimedFundsAddress);

    return account.exists &&
      account.programAddress === ORCHID_LINKS_PROGRAM_ADDRESS
      ? decodeUnclaimedFunds(account.data)
      : null;
  };

  const now = () => svm.getClock().unixTimestamp;

  const prefund = (account: Address, amount: bigint) =>
    svm.airdrop(account, lamports(amount));

  const sponsor = await fundedSigner();
  const sender = await fundedSigner();

  const createLink = async (amount = 1_000_000n) => {
    const link = await unfundedSigner();
    const orderId = crypto.getRandomValues(new Uint8Array(16));
    const source = await tokenAccount(sender.address, amount);

    const [unclaimedFundsAddress, bump] = await findUnclaimedFundsAddress(
      sender.address,
      link.address,
      orderId,
    );

    const outcome = await send(
      sponsor,
      [
        await getCreateInstruction({
          sender: sender.address,
          rentRecipient: sponsor.address,
          source,
          link: link.address,
          orderId,
          amount,
        }),
      ],
      [sender],
    );

    return {
      link,
      orderId,
      source,
      address: unclaimedFundsAddress,
      bump,
      outcome,
    };
  };

  const donate = async (destination: Address, amount: bigint) => {
    const donor = await fundedSigner();
    const source = await tokenAccount(donor.address, amount);

    return send(
      donor,
      [
        getTransferInstruction({
          source,
          destination,
          authority: donor.address,
          amount,
        }),
      ],
      [],
    );
  };

  return {
    sponsor,
    sender,
    fundedSigner,
    unfundedSigner,
    tokenAccount,
    otherMint,
    send,
    tokenBalance,
    lamportBalance,
    unclaimedFunds,
    now,
    prefund,
    createLink,
    donate,
  };
};

export const withAccount = (
  instruction: Instruction,
  index: number,
  address: Address,
): Instruction => ({
  ...instruction,
  accounts: instruction.accounts?.map((account, position) =>
    position === index ? { ...account, address } : account,
  ),
});
