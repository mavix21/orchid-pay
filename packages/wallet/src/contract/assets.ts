import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { chainProfile } from "../binding/profile";

export const AssetCode = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9]{1,12}$/u),
).pipe(Schema.brand("AssetCode"));

export type AssetCode = typeof AssetCode.Type;

export const AssetId = Schema.NonEmptyString.pipe(Schema.brand("AssetId"));

export type AssetId = typeof AssetId.Type;

export const Asset = Schema.Struct({ id: AssetId, code: AssetCode });

export type Asset = typeof Asset.Type;

export const baseAsset: Asset = Schema.decodeSync(Asset)(
  chainProfile.baseAsset,
);

export const nativeAsset: Option.Option<Asset> = Option.map(
  Option.fromUndefinedOr(chainProfile.nativeAsset),
  (terms) => Schema.decodeSync(Asset)(terms),
);

export const sameAsset = (left: Asset, right: Asset) =>
  left.id === right.id && left.code === right.code;

export const isNativeAsset = (asset: Asset) =>
  Option.exists(nativeAsset, (native) => native.id === asset.id);

export const NonNativeAsset = Asset.check(
  Schema.makeFilter((asset: Asset) => !isNativeAsset(asset)),
);

export interface AssetPrecision {
  readonly decimals: number;
  readonly maximum: bigint;
}

export const precisionOf = (asset: Asset): AssetPrecision =>
  chainProfile.precisionOf(asset.id);

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
