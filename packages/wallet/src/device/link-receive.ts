import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import {
  type AccountAddress,
  type Approval,
  type AssetDraft,
  AssetOrder,
  type AssetStep,
  AssetOrderId,
  type PaymentLinkOpen,
  type PaymentLinkStep,
  ReceiveLink,
  type WalletPort,
  type WalletUnavailable,
  sameAsset,
} from "../contract";
import { approvalMargin } from "../policy";
import {
  type ClaimKind,
  type ClaimReviews,
  reviewedClaims,
} from "./claim-reviews";
import type {
  CorruptDeviceWallet,
  KeyStore,
  KeyStoreUnavailable,
  PublicDeviceWallet,
} from "./key-store";
import { isIssuedBy, network, readDraft } from "../device-network";
import {
  type ConfirmLinkReceiveOutcome,
  type LinkReceiveTarget,
  LinkReceiveReview,
  LinkCodeMismatch,
  NoWallet,
  type PaymentLinkOutcome,
  type ReviewLinkReceiveOutcome,
} from "./outcomes";
import { pendingSteps, pollSchedule } from "./polling";
import { type LinkCode, linkAddressOf, opensLink } from "./link-code";
import { approveWithLinkCode } from "./signing";

export const receiveCurrentUntil = (review: LinkReceiveReview) =>
  DateTime.toEpochMillis(review.draft.request.expiresAt) -
  approvalMargin * 1000;

export const receiveReviewJson = Schema.encodeSync(
  Schema.fromJsonString(LinkReceiveReview),
);

export const receiveReviewFromJson = Schema.decodeSync(
  Schema.fromJsonString(LinkReceiveReview),
);

export const receiveReviewOf = (
  wallet: PublicDeviceWallet,
  order: AssetOrder,
  draft: AssetDraft,
  redrafted: boolean,
  target: LinkReceiveTarget,
) => {
  const facts = readDraft(draft.request);
  const { action } = order;

  if (
    Option.isNone(facts) ||
    !Predicate.isTagged(facts.value, "LinkReceiveFacts") ||
    !Predicate.isTagged(action, "ReceiveLink")
  )
    return Option.none();

  const receive = facts.value;

  if (
    order.wallet !== wallet.address ||
    wallet.reserveSponsor === undefined ||
    receive.reserveSponsor !== wallet.reserveSponsor ||
    receive.destination !== wallet.address ||
    receive.memo !== undefined ||
    receive.link !== action.link ||
    action.link !== target.link ||
    receive.link === wallet.address ||
    receive.unclaimedFunds !== action.unclaimedFunds ||
    action.unclaimedFunds !== target.unclaimedFunds ||
    !sameAsset(receive.asset, target.asset) ||
    receive.amount !== target.amount ||
    isIssuedBy(receive.asset, wallet.address)
  )
    return Option.none();

  return Option.some({
    maxTime: receive.maxTime,
    review: new LinkReceiveReview({
      order,
      draft,
      redrafted,
      network,
      link: target.link,
      unclaimedFunds: target.unclaimedFunds,
      asset: target.asset,
      amount: target.amount,
      sender: target.sender,
    }),
  });
};

export const linkReceiveKind: ClaimKind<LinkReceiveTarget, LinkReceiveReview> =
  {
    reviewOf: receiveReviewOf,
    targetOf: (shown) => shown,
    json: receiveReviewJson,
    fromJson: receiveReviewFromJson,
    concluded: () => Effect.void,
  };

export const receiveOrder = (
  wallet: AccountAddress,
  target: LinkReceiveTarget,
) =>
  new AssetOrder({
    id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
    wallet,
    action: ReceiveLink.make({
      link: target.link,
      unclaimedFunds: target.unclaimedFunds,
    }),
  });

export class OpenedLink extends Data.TaggedClass(
  "OpenedLink",
)<LinkReceiveTarget> {}

export const openLink = Effect.fn("Device.openLink")(function* (
  port: Pick<WalletPort, "paymentLink">,
  code: LinkCode,
): Effect.fn.Return<
  OpenedLink | Exclude<PaymentLinkStep, PaymentLinkOpen> | LinkCodeMismatch,
  WalletUnavailable
> {
  const address = linkAddressOf(code);

  if (Option.isNone(address)) return new LinkCodeMismatch();

  const link = address.value;

  const status = yield* port.paymentLink(link);

  return Predicate.isTagged(status, "PaymentLinkOpen")
    ? new OpenedLink({
        link,
        unclaimedFunds: status.unclaimedFunds,
        asset: status.asset,
        amount: status.amount,
        sender: status.sender,
      })
    : status;
});

export const releaseReceive = Effect.fn("Device.releaseReceive")(function* (
  port: Pick<WalletPort, "manage">,
  order: AssetOrder,
  approval: Approval,
): Effect.fn.Return<AssetStep, WalletUnavailable> {
  const released = yield* port.manage(order, Option.some(approval));

  if (!Predicate.isTagged(released, "AssetPending")) return released;

  return yield* Effect.repeat(port.manage(order, Option.none()), {
    schedule: pollSchedule<AssetStep>(
      (step) => Predicate.isTagged(step, "AssetPending"),
      () => true,
    ).pipe(Schedule.upTo({ times: pendingSteps - 2 })),
  });
});

export function deviceLinkReceive(
  port: WalletPort,
  store: KeyStore,
  reviews: ClaimReviews,
) {
  const claims = reviewedClaims(port, reviews, linkReceiveKind);

  const status = Effect.fn("Device.paymentLink")(function* (
    code: LinkCode,
  ): Effect.fn.Return<PaymentLinkOutcome, WalletUnavailable> {
    const address = linkAddressOf(code);

    if (Option.isNone(address)) return new LinkCodeMismatch();

    return yield* port.paymentLink(address.value);
  });

  const review = Effect.fn("Device.reviewLinkReceive")(function* (
    code: LinkCode,
  ): Effect.fn.Return<
    ReviewLinkReceiveOutcome,
    WalletUnavailable | KeyStoreUnavailable
  > {
    const target = yield* openLink(port, code);

    if (!(target instanceof OpenedLink)) return target;

    const stored = yield* store.readPublic();

    if (Option.isNone(stored)) return new NoWallet();

    return yield* claims.review(
      stored.value,
      receiveOrder(stored.value.address, target),
      target,
    );
  });

  const confirm = Effect.fn("Device.confirmLinkReceive")(function* (
    shown: LinkReceiveReview,
    code: LinkCode,
  ): Effect.fn.Return<
    ConfirmLinkReceiveOutcome,
    WalletUnavailable | KeyStoreUnavailable | CorruptDeviceWallet
  > {
    if (!opensLink(code, shown.link)) return new LinkCodeMismatch();

    return yield* claims.confirm(shown, (requests) =>
      approveWithLinkCode(code, requests),
    );
  });

  return { status, review, confirm };
}
