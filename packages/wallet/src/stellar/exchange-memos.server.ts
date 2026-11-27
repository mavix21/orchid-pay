import { Keypair, xdr } from "@stellar/stellar-sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { addressRules } from "../address-rules";
import { AccountAddress } from "../contract";
import { network } from "./network";
import type { StellarRpc } from "./ledger.server";

export class KnownExchangeMemo extends Schema.Class<KnownExchangeMemo>(
  "KnownExchangeMemo",
)({
  network: Schema.Literal(network),
  address: AccountAddress.check(
    Schema.makeFilter(addressRules.hasValidChecksum),
  ),
  exchange: Schema.NonEmptyString,
  source: Schema.String.check(
    Schema.makeFilter(
      (value) => URL.canParse(value) && new URL(value).protocol === "https:",
    ),
  ),
}) {}

export const knownExchangeMemos: ReadonlyArray<KnownExchangeMemo> = [];

export const memoRequiredDataName = "config.memo_required";

const sep29Source = "https://stellar.org/protocol/sep-29";

const memoRequiredValue = new xdr.DataValue(new TextEncoder().encode("1"));

export function exchangeMemoFor(
  address: AccountAddress,
  entries: ReadonlyArray<KnownExchangeMemo> = knownExchangeMemos,
): Option.Option<KnownExchangeMemo> {
  return Option.fromNullishOr(
    entries.find((entry) => entry.address === address),
  );
}

export const memoRequirementFor = Effect.fn("Chain.memoRequiredFor")(function* (
  rpc: StellarRpc,
  address: AccountAddress,
  entries: ReadonlyArray<KnownExchangeMemo> = knownExchangeMemos,
) {
  const known = exchangeMemoFor(address, entries);

  if (Option.isSome(known)) return known;

  const accountId = Keypair.fromPublicKey(address).xdrAccountId();

  const response = yield* rpc.entries([
    xdr.LedgerKey.data(
      new xdr.LedgerKeyData({ accountId, dataName: memoRequiredDataName }),
    ),
  ]);

  const published = (response.entries ?? []).some((entry) => {
    const data = xdr.LedgerEntryData.fromXdr(entry.xdr, "base64");

    return (
      data.type === "data" &&
      data.value.accountId.equals(accountId) &&
      data.value.dataName.toString() === memoRequiredDataName &&
      data.value.dataValue.equals(memoRequiredValue)
    );
  });

  return published
    ? Option.some(
        new KnownExchangeMemo({
          network,
          address,
          exchange: "Exchange",
          source: sep29Source,
        }),
      )
    : Option.none<KnownExchangeMemo>();
});
