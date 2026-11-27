import { expect, it } from "@effect/vitest";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AccountAddress } from "../src/contract";
import { accountFromEntries } from "../src/stellar/ledger.server";

const holder = Keypair.random();

const sponsor = Schema.decodeSync(AccountAddress)(Keypair.random().publicKey());

const accountEntry = (overrides: {
  readonly numSubEntries?: number;
  readonly flags?: number;
  readonly thresholds?: ReadonlyArray<number>;
  readonly signers?: ReadonlyArray<xdr.Signer>;
  readonly numSponsoring?: number;
}) =>
  xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId: holder.xdrAccountId(),
      balance: 10000000n,
      seqNum: 1n,
      numSubEntries: overrides.numSubEntries ?? 0,
      inflationDest: null,
      flags: overrides.flags ?? 0,
      homeDomain: "",
      thresholds: new Uint8Array(overrides.thresholds ?? [1, 0, 0, 0]),
      signers: [...(overrides.signers ?? [])],
      ext:
        overrides.numSponsoring === undefined
          ? xdr.AccountEntryExt.v0()
          : xdr.AccountEntryExt.v1(
              new xdr.AccountEntryExtensionV1({
                liabilities: new xdr.Liabilities({ buying: 0n, selling: 0n }),
                ext: xdr.AccountEntryExtensionV1Ext.v2(
                  new xdr.AccountEntryExtensionV2({
                    numSponsored: 0,
                    numSponsoring: overrides.numSponsoring,
                    signerSponsoringIDs: [],
                    ext: xdr.AccountEntryExtensionV2Ext.v0(),
                  }),
                ),
              }),
            ),
    }),
  ).toXDR("base64");

const signer = new xdr.Signer({
  key: xdr.SignerKey.signerKeyTypeEd25519(Keypair.random().rawPublicKey()),
  weight: 1,
});

it.each([
  ["a funded account with default settings", {}, true],
  ["a subentry", { numSubEntries: 1 }, false],
  ["an extra signer", { signers: [signer] }, false],
  ["a changed threshold", { thresholds: [1, 1, 1, 1] }, false],
  ["a disabled master key", { thresholds: [0, 0, 0, 0] }, false],
  ["the immutable flag", { flags: 4 }, false],
  ["a sponsored entry it pays for", { numSponsoring: 1 }, false],
] as const)(
  "a link account with %s is read as untouched: %s",
  (_name, overrides, untouched) => {
    const state = Option.getOrThrow(
      accountFromEntries([{ xdr: accountEntry(overrides) }], 100, sponsor),
    );

    expect(state.untouched).toBe(untouched);
  },
);
