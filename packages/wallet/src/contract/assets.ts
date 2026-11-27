import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const AssetCode = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9]{1,12}$/u),
).pipe(Schema.brand("AssetCode"));

export type AssetCode = typeof AssetCode.Type;

export const AssetId = Schema.NonEmptyString.pipe(Schema.brand("AssetId"));

export type AssetId = typeof AssetId.Type;

export const Asset = Schema.Struct({ id: AssetId, code: AssetCode });

export type Asset = typeof Asset.Type;

export const nativeAsset = Asset.make({
  id: Schema.decodeSync(AssetId)("native"),
  code: Schema.decodeSync(AssetCode)("XLM"),
});

export const baseAsset = Asset.make({
  id: Schema.decodeSync(AssetId)(
    "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  ),
  code: Schema.decodeSync(AssetCode)("USDC"),
});

export const sameAsset = (left: Asset, right: Asset) =>
  left.id === right.id && left.code === right.code;

export const needsTrustline = (asset: Asset) => asset.id !== nativeAsset.id;

export const TrustlineAsset = Asset.check(Schema.makeFilter(needsTrustline));

export interface AssetPrecision {
  readonly decimals: number;
  readonly maximum: bigint;
}

const sevenDecimals: AssetPrecision = {
  decimals: 7,
  maximum: 9223372036854775807n,
};

export const precisionOf: (asset: Asset) => AssetPrecision = () =>
  sevenDecimals;

export const Amount = Schema.BigIntFromString.check(
  Schema.isGreaterThanOrEqualToBigInt(0n),
).pipe(Schema.brand("Amount"));

export type Amount = typeof Amount.Type;

export const PositiveAmount = Amount.check(Schema.isGreaterThanBigInt(0n)).pipe(
  Schema.brand("PositiveAmount"),
);

export type PositiveAmount = typeof PositiveAmount.Type;

export const withinAssetMaximum = Schema.makeFilter(
  ({
    asset,
    amount,
  }: {
    readonly asset: Asset;
    readonly amount: PositiveAmount;
  }) => amount <= precisionOf(asset).maximum,
);

const unitsPerWhole = ({ decimals }: AssetPrecision) => 10n ** BigInt(decimals);

export function parseAmount(
  text: string,
  precision: AssetPrecision,
): Option.Option<PositiveAmount> {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(text) || text.length > 32)
    return Option.none();

  const [whole = "0", fraction = ""] = text.split(".");

  if (fraction.length > precision.decimals) return Option.none();

  const units =
    BigInt(whole) * unitsPerWhole(precision) +
    BigInt(fraction.padEnd(precision.decimals, "0"));

  if (units > precision.maximum) return Option.none();

  return Schema.decodeOption(PositiveAmount)(units.toString());
}

export function formatAmount(
  amount: Amount,
  precision: AssetPrecision,
): string {
  const scale = unitsPerWhole(precision);

  const fraction = (amount % scale)
    .toString()
    .padStart(precision.decimals, "0")
    .replace(/0+$/, "");

  return `${amount / scale}${fraction ? `.${fraction}` : ""}`;
}
