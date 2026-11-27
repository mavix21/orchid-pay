import type { LocalAmount, PeruvianMobile } from "@workspace/wallet";

import { formattingLocale } from "@/locale/format";

const centsPerSol = 100n;

export const localAmountLabel = ({ currency, minorUnits }: LocalAmount) =>
  new Intl.NumberFormat(formattingLocale(), {
    style: "currency",
    currency,
  }).format(
    Number(minorUnits / centsPerSol) +
      Number(minorUnits % centsPerSol) / Number(centsPerSol),
  );

export const mobileDigits = (typed: string) =>
  typed.replaceAll(/\D/gu, "").slice(0, 9);

export const mobileLabel = (mobile: PeruvianMobile | string) =>
  mobileDigits(mobile)
    .replaceAll(/(\d{3})(?=\d)/gu, "$1 ")
    .trim();
