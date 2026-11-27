import { expect, it } from "@effect/vitest";
import { Keypair, xdr } from "@stellar/stellar-sdk";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import { AccountAddress } from "../src/contract";
import { ChainUnreachable } from "../src/server/chain-errors.server";
import {
  KnownExchangeMemo,
  memoRequirementFor,
} from "../src/stellar/exchange-memos.server";
import { stellarRpc } from "../src/stellar/ledger.server";
import { defaultRpcTimeout } from "../src/server/settings.server";
import { network } from "../src/stellar/network";
import { rpcAnswering, rpcError, rpcOk, testRpcUrl } from "./rpc-answering";

const checkMemo = (
  address: AccountAddress,
  entries: ReadonlyArray<KnownExchangeMemo>,
) =>
  Effect.flatMap(HttpClient.HttpClient, (client) =>
    memoRequirementFor(
      stellarRpc(client, testRpcUrl, defaultRpcTimeout),
      address,
      entries,
    ),
  );

const ledgerPublishing = (
  address: AccountAddress,
  memoRequired: Option.Option<Uint8Array>,
) =>
  rpcAnswering((keys) => {
    const accountId = Keypair.fromPublicKey(address).xdrAccountId();

    const requested = xdr.LedgerKey.data(
      new xdr.LedgerKeyData({ accountId, dataName: "config.memo_required" }),
    ).toXdr("base64");

    return rpcOk({
      latestLedger: 7,
      entries:
        Option.isSome(memoRequired) && keys.includes(requested)
          ? [
              {
                xdr: xdr.LedgerEntryData.data(
                  new xdr.DataEntry({
                    accountId,
                    dataName: "config.memo_required",
                    dataValue: memoRequired.value,
                    ext: xdr.DataEntryExt.v0(),
                  }),
                ).toXdr("base64"),
              },
            ]
          : [],
    });
  });

const randomAddress = () =>
  Schema.decodeSync(AccountAddress)(Keypair.random().publicKey());

it.effect(
  "registered addresses answer without the ledger, and others fail while unreachable",
  () =>
    Effect.gen(function* () {
      const address = randomAddress();

      const entry = new KnownExchangeMemo({
        network,
        address,
        exchange: "Synthetic exchange fixture",
        source: "https://example.com/fixtures/stellar-testnet-memo-required",
      });

      const http = rpcAnswering(() => rpcError);

      expect(
        yield* checkMemo(address, [entry]).pipe(Effect.provide(http)),
      ).toEqual(Option.some(entry));
      expect(
        yield* checkMemo(randomAddress(), [entry]).pipe(
          Effect.provide(http),
          Effect.flip,
        ),
      ).toBeInstanceOf(ChainUnreachable);
    }),
);

const published = (text: string) => Option.some(new TextEncoder().encode(text));

it.effect.each([
  { name: '"1"', memoRequired: published("1"), required: true },
  { name: '"11"', memoRequired: published("11"), required: false },
])(
  "an unregistered account publishing $name requires a memo: $required",
  ({ memoRequired, required }) =>
    Effect.gen(function* () {
      const address = randomAddress();

      expect(
        yield* checkMemo(address, []).pipe(
          Effect.provide(ledgerPublishing(address, memoRequired)),
        ),
      ).toEqual(
        required
          ? Option.some(
              new KnownExchangeMemo({
                network,
                address,
                exchange: "Exchange",
                source: "https://stellar.org/protocol/sep-29",
              }),
            )
          : Option.none(),
      );
    }),
);
