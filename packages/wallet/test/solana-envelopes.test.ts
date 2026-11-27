import { expect, it } from "@effect/vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  AuthorityType,
  TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getSetAuthorityInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import {
  AccountRole,
  type Address,
  type Instruction,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  getAddressDecoder,
  getBase64Decoder,
  getBase64Encoder,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import {
  SYSTEM_PROGRAM_ADDRESS,
  USDC_MINT_ADDRESS,
  findUnclaimedFundsAddress,
  getClaimInstruction,
  getCreateInstruction,
  getReclaimInstruction,
} from "@workspace/orchid-links";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { PositiveAmount, UnsignedEnvelope } from "../src/contract";
import { encodeEnvelope } from "../src/solana/envelope-codec";
import {
  computeUnitLimits,
  draftLinkReceive,
  draftOpening,
  draftPayment,
  draftPaymentLink,
  draftReclaim,
} from "../src/solana/envelope-drafts";
import { EnvelopeFacts, readEnvelope } from "../src/solana/envelopes";
import { memoProgramAddress } from "../src/solana/memo";
import { solanaSigningScheme } from "../src/solana/signing-scheme";

const addressDecoder = getAddressDecoder();

const keyAddress = (byte: number) =>
  addressDecoder.decode(ed25519.getPublicKey(new Uint8Array(32).fill(byte)));

const sponsor = keyAddress(1);
const holder = keyAddress(2);
const link = keyAddress(3);
const recipient = keyAddress(4);
const stranger = keyAddress(5);

const drafting = {
  sponsor,
  blockhash: blockhash(addressDecoder.decode(new Uint8Array(32).fill(7))),
  lastValidBlockHeight: 4_000_000_000n,
  draftedSlot: 4_100_000_000n,
  computeUnitPrice: 0n,
};

const amount = Schema.decodeSync(PositiveAmount)("5500001");
const orderId = new Uint8Array(16).fill(9);
const memo = { type: "text", value: "exchange dépôt 🪷" } as const;

const officialUsdcAccount = async (owner: Address) => {
  const [account] = await findAssociatedTokenPda({
    owner,
    mint: USDC_MINT_ADDRESS,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  return account;
};

const officialUnclaimedFunds = async () => {
  const [unclaimedFunds] = await findUnclaimedFundsAddress(
    holder,
    link,
    orderId,
  );

  return unclaimedFunds;
};

const unclaimedFunds = await officialUnclaimedFunds();
const holderAccount = await officialUsdcAccount(holder);
const recipientAccount = await officialUsdcAccount(recipient);

const memoInstruction = (data: Uint8Array): Instruction => ({
  programAddress: memoProgramAddress,
  data,
});

const writtenMemo = memoInstruction(new TextEncoder().encode(memo.value));

const createAccountInstruction = (payer: Address) =>
  getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: createNoopSigner(payer),
    owner: holder,
    mint: USDC_MINT_ADDRESS,
  });

const closeAuthorityInstruction = (newAuthority: Address) =>
  getSetAuthorityInstruction({
    owned: holderAccount,
    owner: createNoopSigner(holder),
    authorityType: AuthorityType.CloseAccount,
    newAuthority,
  });

const transferInstruction = (
  source: Address = holderAccount,
  destination: Address = recipientAccount,
  units: bigint = amount,
) =>
  getTransferCheckedInstruction({
    source,
    mint: USDC_MINT_ADDRESS,
    destination,
    authority: createNoopSigner(holder),
    amount: units,
    decimals: 6,
  });

const unsignedTransferInstruction = (): Instruction => {
  const transfer = transferInstruction();

  return {
    ...transfer,
    accounts: transfer.accounts.map(({ address, role }) => ({
      address,
      role: address === holder ? AccountRole.READONLY : role,
    })),
  };
};

const createLinkInstruction = (rentRecipient: Address) =>
  getCreateInstruction({
    sender: holder,
    rentRecipient,
    source: holderAccount,
    link,
    orderId,
    amount,
  });

const claimInstruction = (rentRecipient: Address) =>
  getClaimInstruction({
    signer: link,
    unclaimedFunds,
    destination: recipientAccount,
    rentRecipient,
  });

const reclaimInstruction = (destination: Address) =>
  getReclaimInstruction({
    signer: holder,
    unclaimedFunds,
    destination,
    rentRecipient: sponsor,
  });

interface Assembly {
  readonly feePayer?: Address;
  readonly computeUnitLimit?: number | undefined;
  readonly computeUnitPrice?: bigint;
  readonly lookupTable?: ReadonlyArray<Address>;
}

const compiledMessage = (
  instructions: ReadonlyArray<Instruction>,
  {
    feePayer = sponsor,
    computeUnitLimit,
    computeUnitPrice = 0n,
    lookupTable,
  }: Assembly,
) => {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (current) => setTransactionMessageFeePayer(feePayer, current),
    (current) => setTransactionMessageLifetimeUsingBlockhash(drafting, current),
    (current) =>
      setTransactionMessageComputeUnitLimit(computeUnitLimit, current),
    (current) =>
      setTransactionMessageComputeUnitPrice(computeUnitPrice, current),
    (current) => appendTransactionMessageInstructions(instructions, current),
  );

  const compiled = lookupTable
    ? compressTransactionMessageUsingAddressLookupTables(message, {
        [keyAddress(6)]: [...lookupTable],
      })
    : message;

  return compileTransaction(compiled).messageBytes;
};

const assemble = (
  instructions: ReadonlyArray<Instruction>,
  assembly: Assembly,
) =>
  encodeEnvelope({
    ...drafting,
    messageBytes: compiledMessage(instructions, assembly),
  });

const honestDrafts = {
  opening: {
    envelope: draftOpening({ ...drafting, address: holder }),
    facts: EnvelopeFacts.OpeningFacts({ ...drafting, address: holder }),
    computeUnitLimit: computeUnitLimits.opening,
    instructions: [
      await createAccountInstruction(sponsor),
      closeAuthorityInstruction(sponsor),
    ],
  },
  payment: {
    envelope: draftPayment({
      ...drafting,
      from: holder,
      destinationTokenAccount: recipientAccount,
      amount,
    }),
    facts: EnvelopeFacts.PaymentFacts({
      ...drafting,
      from: holder,
      destinationTokenAccount: recipientAccount,
      amount,
    }),
    computeUnitLimit: computeUnitLimits.payment,
    instructions: [transferInstruction()],
  },
  "payment with a memo": {
    envelope: draftPayment({
      ...drafting,
      from: holder,
      destinationTokenAccount: recipientAccount,
      amount,
      memo,
    }),
    facts: EnvelopeFacts.PaymentFacts({
      ...drafting,
      from: holder,
      destinationTokenAccount: recipientAccount,
      amount,
      memo,
    }),
    computeUnitLimit: computeUnitLimits.payment,
    instructions: [writtenMemo, transferInstruction()],
  },
  "payment link": {
    envelope: draftPaymentLink({
      ...drafting,
      from: holder,
      link,
      orderId,
      amount,
    }),
    facts: EnvelopeFacts.PaymentLinkFacts({
      ...drafting,
      from: holder,
      link,
      orderId,
      amount,
      unclaimedFunds,
    }),
    computeUnitLimit: computeUnitLimits.paymentLink,
    instructions: [await createLinkInstruction(sponsor)],
  },
  "link receive": {
    envelope: draftLinkReceive({
      ...drafting,
      link,
      unclaimedFunds,
      destinationTokenAccount: recipientAccount,
    }),
    facts: EnvelopeFacts.LinkReceiveFacts({
      ...drafting,
      link,
      unclaimedFunds,
      destinationTokenAccount: recipientAccount,
    }),
    computeUnitLimit: computeUnitLimits.linkReceive,
    instructions: [await claimInstruction(sponsor)],
  },
  "link receive with a memo": {
    envelope: draftLinkReceive({
      ...drafting,
      link,
      unclaimedFunds,
      destinationTokenAccount: recipientAccount,
      memo,
    }),
    facts: EnvelopeFacts.LinkReceiveFacts({
      ...drafting,
      link,
      unclaimedFunds,
      destinationTokenAccount: recipientAccount,
      memo,
    }),
    computeUnitLimit: computeUnitLimits.linkReceive,
    instructions: [writtenMemo, await claimInstruction(sponsor)],
  },
  reclaim: {
    envelope: draftReclaim({ ...drafting, address: holder, unclaimedFunds }),
    facts: EnvelopeFacts.ReclaimFacts({
      ...drafting,
      address: holder,
      unclaimedFunds,
    }),
    computeUnitLimit: computeUnitLimits.reclaim,
    instructions: [await reclaimInstruction(holderAccount)],
  },
};

const sponsorDrain: Instruction = {
  programAddress: SYSTEM_PROGRAM_ADDRESS,
  accounts: [
    { address: sponsor, role: AccountRole.WRITABLE_SIGNER },
    { address: stranger, role: AccountRole.WRITABLE },
  ],
  data: new Uint8Array([2, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0]),
};

const everyKind = Object.entries(honestDrafts);

it.each(everyKind)(
  "%s drafts the exact message, is signed over it and reads back",
  (_name, honest) => {
    expect(honest.envelope).toBe(assemble(honest.instructions, honest));
    expect(readEnvelope(honest.envelope, sponsor)).toEqual(
      Option.some(honest.facts),
    );
    expect(solanaSigningScheme.signingPayload(honest.envelope)).toEqual(
      new Uint8Array(compiledMessage(honest.instructions, honest)),
    );
  },
);

const { payment, opening } = honestDrafts;

it.each([
  [
    "another fee payer",
    assemble(payment.instructions, { ...payment, feePayer: stranger }),
  ],
  [
    "an extra instruction appended",
    assemble([...payment.instructions, sponsorDrain], payment),
  ],
  [
    "an extra instruction prepended",
    assemble([sponsorDrain, ...opening.instructions], opening),
  ],
  [
    "an address lookup table",
    assemble(payment.instructions, {
      ...payment,
      lookupTable: [recipientAccount],
    }),
  ],
  [
    "a third signer",
    assemble(
      [
        {
          ...transferInstruction(),
          accounts: [
            ...transferInstruction().accounts,
            { address: stranger, role: AccountRole.READONLY_SIGNER },
          ],
        },
      ],
      payment,
    ),
  ],
  [
    "the sponsor as its only signer",
    assemble([unsignedTransferInstruction()], payment),
  ],
  [
    "another compute unit limit",
    assemble(payment.instructions, {
      ...payment,
      computeUnitLimit: computeUnitLimits.payment + 1,
    }),
  ],
  [
    "no compute unit limit",
    assemble(payment.instructions, {
      ...payment,
      computeUnitLimit: undefined,
    }),
  ],
  [
    "an unknown program",
    assemble([{ ...transferInstruction(), programAddress: stranger }], payment),
  ],
  [
    "a source other than the sender's USDC account",
    assemble([transferInstruction(stranger)], payment),
  ],
  [
    "an amount above the asset maximum",
    assemble(
      [
        transferInstruction(
          holderAccount,
          recipientAccount,
          9_223_372_036_854_775_808n,
        ),
      ],
      payment,
    ),
  ],
  [
    "a memo that is not UTF-8",
    assemble(
      [memoInstruction(new Uint8Array([0xff])), ...payment.instructions],
      payment,
    ),
  ],
  [
    "a memo over 28 bytes",
    assemble(
      [
        memoInstruction(new TextEncoder().encode("é".repeat(15))),
        ...payment.instructions,
      ],
      payment,
    ),
  ],
  [
    "an account creation paid by someone else",
    assemble(
      [
        await createAccountInstruction(holder),
        closeAuthorityInstruction(sponsor),
      ],
      honestDrafts.opening,
    ),
  ],
  [
    "a close authority other than the sponsor",
    assemble(
      [
        await createAccountInstruction(sponsor),
        closeAuthorityInstruction(stranger),
      ],
      honestDrafts.opening,
    ),
  ],
  [
    "link rent paid by someone else",
    assemble(
      [await createLinkInstruction(stranger)],
      honestDrafts["payment link"],
    ),
  ],
  [
    "link receive rent returned to someone else",
    assemble([await claimInstruction(stranger)], honestDrafts["link receive"]),
  ],
  [
    "a reclaim to another destination",
    assemble(
      [await reclaimInstruction(recipientAccount)],
      honestDrafts.reclaim,
    ),
  ],
])("a message with %s is refused", (_name, envelope) => {
  expect(readEnvelope(envelope, sponsor)).toEqual(Option.none());
});

it.each([
  ["the opened wallet", draftOpening({ ...drafting, address: sponsor })],
  [
    "the payment sender",
    draftPayment({
      ...drafting,
      from: sponsor,
      destinationTokenAccount: recipientAccount,
      amount,
    }),
  ],
  [
    "the payment destination",
    draftPayment({
      ...drafting,
      from: holder,
      destinationTokenAccount: sponsor,
      amount,
    }),
  ],
  [
    "the payment link sender",
    draftPaymentLink({ ...drafting, from: sponsor, link, orderId, amount }),
  ],
  [
    "the link of a new payment link",
    draftPaymentLink({
      ...drafting,
      from: holder,
      link: sponsor,
      orderId,
      amount,
    }),
  ],
  [
    "the receiving link",
    draftLinkReceive({
      ...drafting,
      link: sponsor,
      unclaimedFunds,
      destinationTokenAccount: recipientAccount,
    }),
  ],
  [
    "the link receive destination",
    draftLinkReceive({
      ...drafting,
      link,
      unclaimedFunds,
      destinationTokenAccount: sponsor,
    }),
  ],
  [
    "the reclaiming wallet",
    draftReclaim({ ...drafting, address: sponsor, unclaimedFunds }),
  ],
])("the sponsor is refused as %s", (_name, envelope) => {
  expect(readEnvelope(envelope, sponsor)).toEqual(Option.none());
});

it.each([
  [
    "a link receive",
    draftLinkReceive({
      ...drafting,
      link,
      unclaimedFunds: stranger,
      destinationTokenAccount: recipientAccount,
    }),
  ],
  [
    "a reclaim",
    draftReclaim({ ...drafting, address: holder, unclaimedFunds: stranger }),
  ],
])(
  "%s of unclaimed funds at an on-curve address is refused",
  (_name, envelope) => {
    expect(readEnvelope(envelope, sponsor)).toEqual(Option.none());
  },
);

it.each([
  ["accepts", 833_333n, true],
  ["refuses", 833_334n, false],
])(
  "the parser %s a payment at %s micro-lamports per compute unit",
  (_name, computeUnitPrice, accepted) => {
    const envelope = draftPayment({
      ...drafting,
      computeUnitPrice,
      from: holder,
      destinationTokenAccount: recipientAccount,
      amount,
    });

    expect(Option.isSome(readEnvelope(envelope, sponsor))).toBe(accepted);
  },
);

const bytesOf = (envelope: UnsignedEnvelope) =>
  new Uint8Array(getBase64Encoder().encode(envelope));

const envelopeOf = (bytes: Uint8Array) =>
  Schema.decodeSync(UnsignedEnvelope)(getBase64Decoder().decode(bytes));

it.each([
  [
    "of an unknown version",
    envelopeOf(new Uint8Array([2, ...bytesOf(payment.envelope).slice(1)])),
  ],
  ["cut short", envelopeOf(bytesOf(payment.envelope).slice(0, 12))],
  [
    "with trailing bytes",
    envelopeOf(new Uint8Array([...bytesOf(payment.envelope), 0])),
  ],
  [
    "that is not base64",
    Schema.decodeSync(UnsignedEnvelope)("not an envelope"),
  ],
  ["that is empty", Schema.decodeSync(UnsignedEnvelope)("")],
])("an envelope %s reads as nothing", (_name, envelope) => {
  expect(readEnvelope(envelope, sponsor)).toEqual(Option.none());
});
