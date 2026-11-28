import type { LocalAmount } from "@workspace/wallet";

import { formattingLocale } from "@/locale/format";

const minorUnitsPerMajor = 100n;

export const localAmountLabel = ({ currency, minorUnits }: LocalAmount) =>
  new Intl.NumberFormat(formattingLocale(), {
    style: "currency",
    currency,
  }).format(
    Number(minorUnits / minorUnitsPerMajor) +
      Number(minorUnits % minorUnitsPerMajor) / Number(minorUnitsPerMajor),
  );
