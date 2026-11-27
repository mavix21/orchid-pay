import {
  Asset as StellarAsset,
  Claimant as StellarClaimant,
  Keypair,
  xdr,
} from "@stellar/stellar-sdk";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  Amount,
  type Asset,
  UnclaimedFundsId,
  PositiveAmount,
} from "../contract";
import { fromStellarAsset, isIssuerAccount, toStellarAsset } from "./assets";
import { baseReserve } from "./network";
import type { Holdings, Issuer } from "../server/holdings.server";
import type {
  Claim,
  UnclaimedFundsEntry,
} from "../server/unclaimed-funds.server";
import { type LedgerEntry, sponsorOf, sponsoredBy } from "./ledger.server";

export interface ClaimableBalance {
  readonly unclaimedFunds: UnclaimedFundsId;
  readonly asset: Asset;
  readonly amount: PositiveAmount;
  readonly claimants: ReadonlyArray<StellarClaimant>;
  readonly sponsored: boolean;
}

export const accountKey = (address: AccountAddress) =>
  xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({
      accountId: Keypair.fromPublicKey(address).xdrPublicKey(),
    }),
  );

export const lineKey = (address: AccountAddress, asset: StellarAsset) =>
  xdr.LedgerKey.trustline(
    new xdr.LedgerKeyTrustLine({
      accountId: Keypair.fromPublicKey(address).xdrAccountId(),
      asset: asset.toTrustLineXdrObject(),
    }),
  );

export const unclaimedFundsKey = (unclaimedFunds: UnclaimedFundsId) =>
  xdr.LedgerKey.claimableBalance(
    new xdr.LedgerKeyClaimableBalance({
      balanceId: xdr.ClaimableBalanceId.fromXdr(unclaimedFunds, "hex"),
    }),
  );

const parse = (entries: ReadonlyArray<LedgerEntry>) =>
  entries.map((raw) => ({
    raw,
    data: xdr.LedgerEntryData.fromXdr(raw.xdr, "base64"),
  }));

const owns = (address: AccountAddress, accountId: xdr.PublicKey) =>
  accountId.equals(Keypair.fromPublicKey(address).xdrPublicKey());

const amountOf = (value: bigint) =>
  Schema.decodeSync(Amount)((value < 0n ? 0n : value).toString());

function reservesOf(account: xdr.AccountEntry) {
  const v1 = account.ext.type === "v1" ? account.ext.v1 : undefined;
  const v2 = v1?.ext.type === "v2" ? v1.ext.v2 : undefined;

  return {
    subentries: account.numSubEntries,
    sponsored: v2?.numSponsored ?? 0,
    sponsoring: v2?.numSponsoring ?? 0,
    selling: v1?.liabilities.selling ?? 0n,
  };
}

export function holdingsFromEntries(
  entries: ReadonlyArray<LedgerEntry>,
  sponsor: string,
  address: AccountAddress,
  assets: ReadonlyArray<Asset>,
): Option.Option<Holdings> {
  const own = parse(entries).filter(
    ({ data }) =>
      (data.type === "account" || data.type === "trustline") &&
      owns(address, data.value.accountId),
  );

  const lineOf = (asset: StellarAsset) =>
    own.find(
      ({ data }) =>
        data.type === "trustline" &&
        data.value.asset.equals(asset.toTrustLineXdrObject()),
    );

  const account = own.find(({ data }) => data.type === "account");

  if (!account || account.data.type !== "account") return Option.none();

  const reserves = reservesOf(account.data.value);

  const locked =
    BigInt(2 + reserves.subentries + reserves.sponsoring - reserves.sponsored) *
      baseReserve +
    reserves.selling;

  return Option.some({
    nativeTotal: amountOf(account.data.value.balance),
    reserveSponsor: sponsorOf(account.raw),
    native: amountOf(account.data.value.balance - locked),
    trustlineSlotsUsed: reserves.subentries,
    lines: assets.flatMap((asset) => {
      const line = lineOf(toStellarAsset(asset));

      if (!line || line.data.type !== "trustline") return [];

      const entry = line.data.value;

      const liabilities =
        entry.ext.type === "v1" ? entry.ext.v1.liabilities : undefined;

      return [
        {
          asset,
          balance: amountOf(entry.balance),
          spendable: amountOf(entry.balance - (liabilities?.selling ?? 0n)),
          capacity: amountOf(
            entry.limit - entry.balance - (liabilities?.buying ?? 0n),
          ),
          authorized:
            (entry.flags & xdr.TrustLineFlags.authorizedFlag.value) !== 0,
          clawbackEnabled:
            (entry.flags &
              xdr.TrustLineFlags.trustlineClawbackEnabledFlag.value) !==
            0,
          sponsored: sponsoredBy(line.raw, sponsor),
        },
      ];
    }),
  });
}

export function issuerFromEntries(
  entries: ReadonlyArray<LedgerEntry>,
  asset: Asset,
): Option.Option<Issuer> {
  for (const { data } of parse(entries))
    if (data.type === "account" && isIssuerAccount(asset, data.value.accountId))
      return Option.some({
        authRequired:
          (data.value.flags & xdr.AccountFlags.authRequiredFlag.value) !== 0,
      });

  return Option.none();
}

const claimableAt = (predicate: xdr.ClaimPredicate, at: bigint): boolean => {
  switch (predicate.type) {
    case "claimPredicateUnconditional":
      return true;
    case "claimPredicateAnd":
      return predicate.andPredicates.every((part) => claimableAt(part, at));
    case "claimPredicateOr":
      return predicate.orPredicates.some((part) => claimableAt(part, at));
    case "claimPredicateNot":
      return (
        predicate.notPredicate !== null &&
        !claimableAt(predicate.notPredicate, at)
      );
    case "claimPredicateBeforeAbsoluteTime":
      return at < predicate.absBefore;
    case "claimPredicateBeforeRelativeTime":
      return false;
  }
};

const opensAt = (predicate: xdr.ClaimPredicate) =>
  predicate.type === "claimPredicateNot" &&
  predicate.notPredicate?.type === "claimPredicateBeforeAbsoluteTime"
    ? Option.some(
        DateTime.makeUnsafe(Number(predicate.notPredicate.absBefore) * 1000),
      )
    : Option.none<DateTime.Utc>();

const claimOf = ({ predicate }: StellarClaimant): Claim => ({
  opensAt: opensAt(predicate),
  claimableAt: (at) =>
    claimableAt(
      predicate,
      BigInt(Math.floor(DateTime.toEpochMillis(at) / 1000)),
    ),
});

function paymentLinkAddressOf(
  claimants: ReadonlyArray<StellarClaimant>,
  sender: AccountAddress,
): Option.Option<AccountAddress> {
  if (claimants.length !== 2) return Option.none();

  const [first, second] = claimants;

  if (
    !first ||
    !second ||
    first.predicate.type !== "claimPredicateUnconditional" ||
    second.predicate.type !== "claimPredicateUnconditional" ||
    first.destination === second.destination
  )
    return Option.none();

  const other =
    first.destination === sender
      ? second.destination
      : second.destination === sender
        ? first.destination
        : undefined;

  return other ? Schema.decodeOption(AccountAddress)(other) : Option.none();
}

export const unclaimedFundsEntry = (
  balance: ClaimableBalance,
): UnclaimedFundsEntry => ({
  unclaimedFunds: balance.unclaimedFunds,
  asset: balance.asset,
  amount: balance.amount,
  claimOf: (account) =>
    Option.fromUndefinedOr(
      balance.claimants.find((claimant) => claimant.destination === account),
    ).pipe(Option.map(claimOf)),
  paymentLinkFrom: (sender) =>
    balance.sponsored
      ? paymentLinkAddressOf(balance.claimants, sender)
      : Option.none(),
});

export function unclaimedFundsFromEntries(
  entries: ReadonlyArray<LedgerEntry>,
  sponsor: string,
): ReadonlyArray<UnclaimedFundsEntry> {
  return parse(entries).flatMap(({ raw, data }) =>
    data.type === "claimableBalance"
      ? [
          unclaimedFundsEntry({
            unclaimedFunds: Schema.decodeSync(UnclaimedFundsId)(
              data.value.balanceId.toXdr("hex"),
            ),
            asset: fromStellarAsset(
              StellarAsset.fromOperation(data.value.asset),
            ),
            amount: Schema.decodeSync(PositiveAmount)(
              data.value.amount.toString(),
            ),
            claimants: data.value.claimants.map((claimant) =>
              StellarClaimant.fromXdr(claimant),
            ),
            sponsored: sponsoredBy(raw, sponsor),
          }),
        ]
      : [],
  );
}
