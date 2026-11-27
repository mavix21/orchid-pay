import type { Asset, PositiveAmount } from "@workspace/wallet";

import { inSenderLanguage } from "@/locale/sender-language";
import { m } from "@/paraglide/messages";
import { getLocale } from "@/paraglide/runtime";
import { amountLabel } from "@/send/money";

export type ShareResult = "shared" | "copied" | "dismissed" | "failed";

export interface ShareableLink {
  readonly path: string;
  readonly asset: Asset;
  readonly amount: PositiveAmount;
}

const pageUrl = (path: string) => new URL(path, window.location.origin);

const paymentLinkUrl = ({ path }: ShareableLink) =>
  inSenderLanguage(pageUrl(path), getLocale()).href;

export const nativeShareAvailable = () => "share" in navigator;

const shareMessage = async (
  title: string,
  message: string,
  url: string,
): Promise<ShareResult> => {
  try {
    await navigator.share({ title, text: `${message}\n\n${url}` });

    return "shared";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError"
      ? "dismissed"
      : "failed";
  }
};

export const shareLink = (link: ShareableLink) =>
  shareMessage(
    m.receive_preview_title(),
    m.link_message({ amount: amountLabel(link.amount, link.asset) }),
    paymentLinkUrl(link),
  );

export const sharePaymentRequest = (link: ShareableLink) =>
  shareMessage(
    m.payment_request_message_title(),
    m.payment_request_message({
      amount: amountLabel(link.amount, link.asset),
    }),
    pageUrl(link.path).href,
  );

const copyUrl = async (url: string): Promise<ShareResult> => {
  try {
    await navigator.clipboard.writeText(url);

    return "copied";
  } catch {
    return "failed";
  }
};

export const copyLink = (link: ShareableLink) => copyUrl(paymentLinkUrl(link));

export const copyPaymentRequestLink = (link: ShareableLink) =>
  copyUrl(pageUrl(link.path).href);
