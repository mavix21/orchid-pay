import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  type DestinationAddress,
  LinkRecipient,
  PaymentLinkReceipt,
  type PaymentMemo,
  type PaymentRequestId,
  Profile,
  type TransferDraft,
  TransferOrder,
  sameAsset,
  type TransferIntent,
} from "../contract";
import { type PublicDeviceWallet, receiptJson } from "./key-store";
import { type PaymentLinkFacts, network, readDraft } from "../device-network";

export const clockAllowance = 60;

export const orderRevision = (wallet: PublicDeviceWallet) =>
  wallet.transferRevision ?? 0;

export const sameOrderSlot = (
  left: PublicDeviceWallet,
  right: PublicDeviceWallet,
) =>
  left.transfer?.id === right.transfer?.id &&
  left.paymentRequest === right.paymentRequest &&
  left.approvedUntil === right.approvedUntil &&
  receiptJson(left.linkReceipt ?? null) ===
    receiptJson(right.linkReceipt ?? null) &&
  orderRevision(left) === orderRevision(right);

export const orderJson = Schema.encodeSync(
  Schema.fromJsonString(TransferOrder),
);

export const sameMemo = (
  drafted: PaymentMemo | undefined,
  ordered: PaymentMemo | undefined,
) => drafted?.type === ordered?.type && drafted?.value === ordered?.value;

const destination = (order: TransferOrder, draft: TransferDraft) =>
  Match.valueTags(order.to, {
    Address: ({ value }) => Option.some(value),
    Username: ({ value }) =>
      draft.recipient instanceof Profile && draft.recipient.username === value
        ? Option.some<DestinationAddress>(draft.recipient.address)
        : Option.none<DestinationAddress>(),
    PaymentLink: ({ value }) =>
      draft.recipient instanceof LinkRecipient &&
      draft.recipient.address === value
        ? Option.some<DestinationAddress>(value)
        : Option.none<DestinationAddress>(),
    Phone: () => Option.none<DestinationAddress>(),
  });

export const approvalOutstanding = (wallet: PublicDeviceWallet, now: number) =>
  wallet.approvedUntil !== undefined &&
  wallet.approvedUntil + clockAllowance >= now;

export const matchesIntent = (
  wallet: PublicDeviceWallet,
  intent: TransferIntent,
  paymentRequest: PaymentRequestId | undefined,
) =>
  wallet.transfer !== undefined &&
  wallet.paymentRequest === paymentRequest &&
  orderJson(wallet.transfer) ===
    orderJson(
      new TransferOrder({
        ...intent,
        id: wallet.transfer.id,
        from: wallet.address,
      }),
    );

export const nextLinkReceipt = (
  current: PaymentLinkReceipt | undefined,
  facts: PaymentLinkFacts,
) => {
  const sameOrder =
    current !== undefined &&
    current.network === network &&
    current.address === facts.to &&
    sameAsset(current.asset, facts.asset) &&
    current.amount === facts.amount;

  const prior = sameOrder ? current.attempts : [];

  const attempts = prior.includes(facts.unclaimedFunds)
    ? prior
    : [...prior, facts.unclaimedFunds];

  return new PaymentLinkReceipt({
    network,
    address: facts.to,
    asset: facts.asset,
    amount: facts.amount,
    unclaimedFunds: facts.unclaimedFunds,
    attempts,
  });
};

export const orderedFacts = (
  wallet: PublicDeviceWallet,
  order: TransferOrder,
  draft: TransferDraft,
) => {
  const facts = readDraft(draft.request);
  const to = destination(order, draft);

  if (Option.isNone(facts) || Option.isNone(to)) return Option.none();

  const drafted = facts.value;

  if (
    !(
      Predicate.isTagged(drafted, "PaymentFacts") ||
      Predicate.isTagged(drafted, "ClaimableFacts") ||
      Predicate.isTagged(drafted, "PaymentLinkFacts")
    )
  )
    return Option.none();

  const moves =
    drafted.from === wallet.address &&
    drafted.to === to.value &&
    sameAsset(drafted.asset, order.asset) &&
    drafted.amount === order.amount;

  const matches = Predicate.isTagged(drafted, "PaymentLinkFacts")
    ? moves &&
      Predicate.isTagged(order.to, "PaymentLink") &&
      order.memo === undefined &&
      draft.recipient instanceof LinkRecipient &&
      draft.recipient.address === drafted.to &&
      wallet.reserveSponsor !== undefined &&
      drafted.reserveSponsor === wallet.reserveSponsor &&
      (draft.unclaimedFunds === undefined ||
        draft.unclaimedFunds === drafted.unclaimedFunds)
    : Predicate.isTagged(order.to, "PaymentLink")
      ? false
      : Predicate.isTagged(drafted, "PaymentFacts")
        ? moves && sameMemo(drafted.memo, order.memo)
        : moves &&
          order.memo === undefined &&
          draft.recipient instanceof Profile &&
          wallet.reserveSponsor !== undefined &&
          drafted.reserveSponsor === wallet.reserveSponsor &&
          (draft.unclaimedFunds === undefined ||
            draft.unclaimedFunds === drafted.unclaimedFunds);

  return matches ? Option.some(drafted) : Option.none();
};
