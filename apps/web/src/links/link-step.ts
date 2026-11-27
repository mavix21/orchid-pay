import type {
  PaymentLinkCreated,
  PaymentLinkIntent,
  PaymentReview,
  SavedLinkTarget,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import {
  type CheckRefusal,
  type CreateRefusal,
  type RecoverableLink,
  recoverable,
} from "./outcomes";

export type Delivery = "none" | "dismissed" | "failed" | "shared" | "copied";

export type LinkStep = Data.TaggedEnum<{
  Entering: { readonly problem: Option.Option<string> };
  Reviewing: { readonly intent: PaymentLinkIntent };
  Reviewed: {
    readonly intent: PaymentLinkIntent;
    readonly review: PaymentReview;
    readonly problem: Option.Option<string>;
  };
  Renewing: {
    readonly intent: PaymentLinkIntent;
    readonly review: PaymentReview;
  };
  Creating: {
    readonly intent: PaymentLinkIntent;
    readonly review: PaymentReview;
  };
  Refused: {
    readonly intent: PaymentLinkIntent;
    readonly confirmed: boolean;
    readonly outcome: CreateRefusal;
  };
  Created: { readonly link: PaymentLinkCreated; readonly delivery: Delivery };
  Sharing: { readonly link: PaymentLinkCreated; readonly delivery: Delivery };
  Sent: { readonly link: RecoverableLink; readonly delivery: Delivery };
  Saved: { readonly link: SavedLinkTarget };
  Lost: { readonly link: RecoverableLink };
  Checking: {};
  Checked: { readonly outcome: CheckRefusal };
}>;

export const LinkStep = Data.taggedEnum<LinkStep>();

export const delivered = (delivery: Delivery) =>
  delivery === "shared" || delivery === "copied";

export const nextDelivery = (delivery: Delivery, result: Delivery): Delivery =>
  delivered(delivery) && !delivered(result) ? delivery : result;

export const entering = (problem: Option.Option<string> = Option.none()) =>
  LinkStep.Entering({ problem });

export const lost = (link: RecoverableLink) =>
  LinkStep.Lost({ link: recoverable(link) });

export const saved = ({
  address,
  unclaimedFunds,
  asset,
  amount,
}: SavedLinkTarget) =>
  LinkStep.Saved({ link: { address, unclaimedFunds, asset, amount } });

const keptReceipt = (link: PaymentLinkCreated, delivery: Delivery) => {
  if (delivered(delivery))
    return LinkStep.Sent({ link: recoverable(link), delivery });

  return link.savedOnDevice ? saved(link) : lost(link);
};

export const concealedStep = (step: LinkStep): Option.Option<LinkStep> =>
  Match.valueTags(step, {
    Entering: () => Option.none(),
    Reviewing: () => Option.none(),
    Reviewed: () => Option.none(),
    Renewing: () => Option.none(),
    Creating: () => Option.none(),
    Refused: () => Option.none(),
    Created: ({ link, delivery }) => Option.some(keptReceipt(link, delivery)),
    Sharing: ({ link, delivery }) => Option.some(keptReceipt(link, delivery)),
    Sent: () => Option.some(step),
    Saved: () => Option.some(step),
    Lost: () => Option.some(step),
    Checking: () => Option.none(),
    Checked: () => Option.none(),
  });
