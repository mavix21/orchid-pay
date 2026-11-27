import { getTransferCheckedInstructionDataDecoder } from "@solana-program/token";
import {
  type Address,
  type ReadonlyUint8Array,
  blockhash,
  getCompiledTransactionMessageDecoder,
  getU64Decoder,
} from "@solana/kit";
import {
  USDC_MINT_ADDRESS,
  getCreateInstructionDataDecoder,
} from "@workspace/orchid-links";
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { PositiveAmount, type UnsignedEnvelope } from "../contract";
import { type SolanaEnvelope, decodeEnvelope } from "./envelope-codec";
import {
  type Drafting,
  type LinkReceiveInput,
  type OpeningInput,
  type PaymentInput,
  type PaymentLinkInput,
  type ReclaimInput,
  computeUnitLimits,
  draftLinkReceive,
  draftOpening,
  draftPayment,
  draftPaymentLink,
  draftReclaim,
} from "./envelope-drafts";
import { memoFromData, memoProgramAddress } from "./memo";
import { unclaimedFundsAddressOf } from "./program-addresses";
import { solanaAddressRules } from "./address-rules";
import { solanaProfile } from "./profile";

export const maxPriorityFeeLamports = 50_000n;

export type EnvelopeFacts = Data.TaggedEnum<{
  OpeningFacts: OpeningInput;
  PaymentFacts: PaymentInput;
  PaymentLinkFacts: PaymentLinkInput & { readonly unclaimedFunds: Address };
  LinkReceiveFacts: LinkReceiveInput;
  ReclaimFacts: ReclaimInput;
}>;

export const EnvelopeFacts = Data.taggedEnum<EnvelopeFacts>();

interface ReadInstruction {
  readonly programAddress: Address;
  readonly accounts: ReadonlyArray<Address>;
  readonly data: ReadonlyUint8Array;
}

interface ReadMessage {
  readonly drafting: Drafting;
  readonly action: ReadInstruction;
  readonly preceding: ReadInstruction;
}

const readMessage = (
  envelope: SolanaEnvelope,
  sponsor: Address,
): Option.Option<ReadMessage> => {
  const compiled = getCompiledTransactionMessageDecoder().decode(
    envelope.messageBytes,
  );

  if (compiled.version !== 0) return Option.none();

  const instructions = compiled.instructions.map(
    (instruction): ReadInstruction => ({
      programAddress: compiled.staticAccounts[instruction.programAddressIndex],
      accounts: (instruction.accountIndices ?? []).map(
        (index) => compiled.staticAccounts[index],
      ),
      data: instruction.data ?? new Uint8Array(),
    }),
  );

  const [, priceSetting] = instructions;
  const action = instructions.at(-1);
  const preceding = instructions.at(-2);

  if (!priceSetting || !action || !preceding) return Option.none();

  return Option.some({
    drafting: {
      sponsor,
      blockhash: blockhash(compiled.lifetimeToken),
      lastValidBlockHeight: envelope.lastValidBlockHeight,
      draftedSlot: envelope.draftedSlot,
      computeUnitPrice: getU64Decoder().decode(priceSetting.data, 1),
    },
    action,
    preceding,
  });
};

const amountOf = (units: bigint) =>
  Schema.decodeSync(PositiveAmount)(units.toString());

const memoBefore = ({ programAddress, data }: ReadInstruction) =>
  programAddress === memoProgramAddress ? memoFromData(data) : undefined;

const readers: ReadonlyArray<(message: ReadMessage) => EnvelopeFacts> = [
  ({ drafting, preceding }) =>
    EnvelopeFacts.OpeningFacts({
      ...drafting,
      address: preceding.accounts[2],
    }),
  ({ drafting, action, preceding }) => {
    const [, , destinationTokenAccount, from] = action.accounts;

    return EnvelopeFacts.PaymentFacts({
      ...drafting,
      from,
      destinationTokenAccount,
      amount: amountOf(
        getTransferCheckedInstructionDataDecoder().decode(action.data).amount,
      ),
      memo: memoBefore(preceding),
    });
  },
  ({ drafting, action }) => {
    const [from] = action.accounts;

    const { orderId, link, amount } = getCreateInstructionDataDecoder().decode(
      action.data,
    );

    return EnvelopeFacts.PaymentLinkFacts({
      ...drafting,
      from,
      link,
      orderId,
      amount: amountOf(amount),
      unclaimedFunds: unclaimedFundsAddressOf(from, link, orderId),
    });
  },
  ({ drafting, action, preceding }) => {
    const [link, unclaimedFunds, , destinationTokenAccount] = action.accounts;

    return EnvelopeFacts.LinkReceiveFacts({
      ...drafting,
      link,
      unclaimedFunds,
      destinationTokenAccount,
      memo: memoBefore(preceding),
    });
  },
  ({ drafting, action }) => {
    const [address, unclaimedFunds] = action.accounts;

    return EnvelopeFacts.ReclaimFacts({ ...drafting, address, unclaimedFunds });
  },
];

const redraft = EnvelopeFacts.$match({
  OpeningFacts: draftOpening,
  PaymentFacts: draftPayment,
  PaymentLinkFacts: draftPaymentLink,
  LinkReceiveFacts: draftLinkReceive,
  ReclaimFacts: draftReclaim,
});

const partiesOf = EnvelopeFacts.$match({
  OpeningFacts: ({ address }) => [address],
  PaymentFacts: ({ from, destinationTokenAccount }) => [
    from,
    destinationTokenAccount,
  ],
  PaymentLinkFacts: ({ from, link }) => [from, link],
  LinkReceiveFacts: ({ link, destinationTokenAccount }) => [
    link,
    destinationTokenAccount,
  ],
  ReclaimFacts: ({ address }) => [address],
});

const computeUnitLimitOf = EnvelopeFacts.$match({
  OpeningFacts: () => computeUnitLimits.opening,
  PaymentFacts: () => computeUnitLimits.payment,
  PaymentLinkFacts: () => computeUnitLimits.paymentLink,
  LinkReceiveFacts: () => computeUnitLimits.linkReceive,
  ReclaimFacts: () => computeUnitLimits.reclaim,
});

const priorityFeeLamports = (facts: EnvelopeFacts) =>
  (BigInt(computeUnitLimitOf(facts)) * facts.computeUnitPrice + 999_999n) /
  1_000_000n;

const withinAmountMaximum = (amount: PositiveAmount) =>
  amount <= solanaProfile.precisionOf(USDC_MINT_ADDRESS).maximum;

const valuesAllowed = EnvelopeFacts.$match({
  OpeningFacts: () => true,
  PaymentFacts: ({ amount }) => withinAmountMaximum(amount),
  PaymentLinkFacts: ({ amount }) => withinAmountMaximum(amount),
  LinkReceiveFacts: ({ unclaimedFunds }) =>
    solanaAddressRules.isUnclaimedFundsId(unclaimedFunds),
  ReclaimFacts: ({ unclaimedFunds }) =>
    solanaAddressRules.isUnclaimedFundsId(unclaimedFunds),
});

const factsAllowed = (facts: EnvelopeFacts) =>
  !partiesOf(facts).includes(facts.sponsor) &&
  priorityFeeLamports(facts) <= maxPriorityFeeLamports &&
  valuesAllowed(facts);

export function readEnvelope(
  envelope: UnsignedEnvelope,
  sponsor: Address,
): Option.Option<EnvelopeFacts> {
  const message = Option.flatMap(decodeEnvelope(envelope), (decoded) =>
    Option.flatten(Option.liftThrowable(readMessage)(decoded, sponsor)),
  );

  if (Option.isNone(message)) return Option.none();

  const drafted = Option.liftThrowable(
    (read: (message: ReadMessage) => EnvelopeFacts) => {
      const facts = read(message.value);

      return redraft(facts) === envelope && factsAllowed(facts)
        ? facts
        : undefined;
    },
  );

  return Arr.findFirst(readers, (read) =>
    Option.flatMap(drafted(read), Option.fromUndefinedOr),
  );
}
