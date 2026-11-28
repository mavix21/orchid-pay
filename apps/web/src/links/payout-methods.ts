import {
  ColombianMobile,
  type LocalCurrency,
  MercadoPagoAccount,
  NequiAccount,
  PayoutEmail,
  type PayoutDestination,
  PeruvianMobile,
  PixAccount,
  PixKey,
  YapeAccount,
  payoutCurrencies,
} from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { m } from "@/paraglide/messages";

export type PayoutMethodKind = PayoutDestination["_tag"];

export type AccountEntry = Data.TaggedEnum<{
  Mobile: {
    readonly dialCode: string;
    readonly groups: ReadonlyArray<number>;
    readonly placeholder: string;
  };
  Text: {
    readonly type: "email" | "text";
    readonly placeholder: string;
  };
}>;

const AccountEntry = Data.taggedEnum<AccountEntry>();

export interface PayoutMethod {
  readonly kind: PayoutMethodKind;
  readonly name: string;
  readonly logo: string;
  readonly flag: string;
  readonly currency: LocalCurrency;
  readonly country: () => string;
  readonly accountLabel: () => string;
  readonly accountHint: () => string;
  readonly accountInvalid: () => string;
  readonly entry: AccountEntry;
  readonly destination: (typed: string) => Option.Option<PayoutDestination>;
}

const cashOutAsset = (path: string) => `/cash-out/${path}`;

const digitsOf = (typed: string) => typed.replaceAll(/\D/gu, "");

const groupedDigits = (digits: string, groups: ReadonlyArray<number>) =>
  groups
    .reduce<{ readonly parts: ReadonlyArray<string>; readonly at: number }>(
      ({ parts, at }, size) => ({
        parts: [...parts, digits.slice(at, at + size)],
        at: at + size,
      }),
      { parts: [], at: 0 },
    )
    .parts.filter((part) => part !== "")
    .join(" ");

const yapeGroups = [3, 3, 3];

const nequiGroups = [3, 3, 4];

const pixKeyOf = (typed: string) => {
  const trimmed = typed.trim();

  return /^[\d\s().\-/+]+$/u.test(trimmed)
    ? trimmed.replaceAll(/[\s().\-/]/gu, "")
    : trimmed.toLowerCase();
};

const yape: PayoutMethod = {
  kind: "YapeAccount",
  name: "Yape",
  logo: cashOutAsset("logos/yape.png"),
  flag: cashOutAsset("flags/pe.svg"),
  currency: payoutCurrencies.YapeAccount,
  country: m.payout_country_peru,
  accountLabel: m.payout_yape_label,
  accountHint: m.payout_yape_hint,
  accountInvalid: m.payout_yape_invalid,
  entry: AccountEntry.Mobile({
    dialCode: "+51",
    groups: yapeGroups,
    placeholder: "987 654 321",
  }),
  destination: (typed) =>
    Schema.decodeOption(PeruvianMobile)(typed).pipe(
      Option.map((mobile) => YapeAccount.make({ mobile })),
    ),
};

const pix: PayoutMethod = {
  kind: "PixAccount",
  name: "PIX",
  logo: cashOutAsset("logos/pix.svg"),
  flag: cashOutAsset("flags/br.svg"),
  currency: payoutCurrencies.PixAccount,
  country: m.payout_country_brazil,
  accountLabel: m.payout_pix_label,
  accountHint: m.payout_pix_hint,
  accountInvalid: m.payout_pix_invalid,
  entry: AccountEntry.Text({ type: "text", placeholder: "nome@exemplo.com" }),
  destination: (typed) =>
    Schema.decodeOption(PixKey)(pixKeyOf(typed)).pipe(
      Option.map((key) => PixAccount.make({ key })),
    ),
};

const nequi: PayoutMethod = {
  kind: "NequiAccount",
  name: "Nequi",
  logo: cashOutAsset("logos/nequi.svg"),
  flag: cashOutAsset("flags/co.svg"),
  currency: payoutCurrencies.NequiAccount,
  country: m.payout_country_colombia,
  accountLabel: m.payout_nequi_label,
  accountHint: m.payout_nequi_hint,
  accountInvalid: m.payout_nequi_invalid,
  entry: AccountEntry.Mobile({
    dialCode: "+57",
    groups: nequiGroups,
    placeholder: "300 123 4567",
  }),
  destination: (typed) =>
    Schema.decodeOption(ColombianMobile)(typed).pipe(
      Option.map((mobile) => NequiAccount.make({ mobile })),
    ),
};

const mercadoPago: PayoutMethod = {
  kind: "MercadoPagoAccount",
  name: "Mercado Pago",
  logo: cashOutAsset("logos/mercadopago.svg"),
  flag: cashOutAsset("flags/mx.svg"),
  currency: payoutCurrencies.MercadoPagoAccount,
  country: m.payout_country_mexico,
  accountLabel: m.payout_mercadopago_label,
  accountHint: m.payout_mercadopago_hint,
  accountInvalid: m.payout_mercadopago_invalid,
  entry: AccountEntry.Text({
    type: "email",
    placeholder: "nombre@ejemplo.com",
  }),
  destination: (typed) =>
    Schema.decodeOption(PayoutEmail)(typed.trim().toLowerCase()).pipe(
      Option.map((email) => MercadoPagoAccount.make({ email })),
    ),
};

export const payoutMethods: ReadonlyArray<PayoutMethod> = [
  yape,
  pix,
  nequi,
  mercadoPago,
];

const methodsByKind = {
  YapeAccount: yape,
  PixAccount: pix,
  NequiAccount: nequi,
  MercadoPagoAccount: mercadoPago,
} satisfies { readonly [Kind in PayoutMethodKind]: PayoutMethod };

export const payoutMethodOf = (destination: PayoutDestination) =>
  methodsByKind[destination._tag];

export const typedAccount = (entry: AccountEntry, typed: string) =>
  Match.value(entry).pipe(
    Match.tag("Mobile", ({ groups }) =>
      digitsOf(typed).slice(
        0,
        groups.reduce((total, size) => total + size, 0),
      ),
    ),
    Match.tag("Text", () => typed),
    Match.exhaustive,
  );

export const shownAccount = (entry: AccountEntry, typed: string) =>
  Match.value(entry).pipe(
    Match.tag("Mobile", ({ groups }) => groupedDigits(typed, groups)),
    Match.tag("Text", () => typed),
    Match.exhaustive,
  );

export const payoutAccountLabel = (destination: PayoutDestination) =>
  Match.valueTags(destination, {
    YapeAccount: ({ mobile }) => groupedDigits(mobile, yapeGroups),
    NequiAccount: ({ mobile }) => groupedDigits(mobile, nequiGroups),
    PixAccount: ({ key }) => key,
    MercadoPagoAccount: ({ email }) => email,
  });
