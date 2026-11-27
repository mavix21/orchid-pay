import { Asset as StellarAsset, Keypair, xdr } from "@stellar/stellar-sdk";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  type Asset,
  AssetCode,
  AssetId,
  nativeAsset,
  sameAsset,
} from "../contract";

export function issuedAsset(code: string, issuer: string): Asset {
  const account = Schema.decodeSync(AccountAddress)(issuer);

  return {
    id: Schema.decodeSync(AssetId)(`${code}:${account}`),
    code: Schema.decodeSync(AssetCode)(code),
  };
}

export function fromStellarAsset(asset: StellarAsset): Asset {
  return asset.isNative()
    ? nativeAsset
    : issuedAsset(asset.code, asset.getIssuer() ?? "");
}

const parseId = Option.liftThrowable((id: string) => {
  if (id === nativeAsset.id) return StellarAsset.native();

  const [code = "", issuer = ""] = id.split(":");

  return new StellarAsset(code, issuer);
});

const readBack = Option.liftThrowable(fromStellarAsset);

const stellarAssetOf = (asset: Asset): Option.Option<StellarAsset> =>
  parseId(asset.id).pipe(
    Option.filter((parsed) =>
      Option.exists(readBack(parsed), (canonical) =>
        sameAsset(canonical, asset),
      ),
    ),
  );

export const validAsset = (asset: Asset) =>
  Option.isSome(stellarAssetOf(asset));

export function toStellarAsset(asset: Asset): StellarAsset {
  return Option.getOrThrow(stellarAssetOf(asset));
}

const issuerOf = (asset: Asset) =>
  Option.flatMap(stellarAssetOf(asset), (parsed) =>
    Option.fromUndefinedOr(parsed.getIssuer()),
  );

export const isIssuedBy = (asset: Asset, account: AccountAddress) =>
  Option.contains(issuerOf(asset), account);

export function trustlineColumns(asset: Asset) {
  return {
    code: asset.code,
    issuer: Option.getOrThrow(issuerOf(asset)),
  };
}

const issuerKeypair = (asset: Asset) =>
  Keypair.fromPublicKey(Option.getOrThrow(issuerOf(asset)));

export const issuerAccountKey = (asset: Asset) =>
  xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: issuerKeypair(asset).xdrPublicKey(),
    }),
  );

export const isIssuerAccount = (asset: Asset, accountId: xdr.PublicKey) =>
  accountId.equals(issuerKeypair(asset).xdrPublicKey());
