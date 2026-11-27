import { Keypair } from "@stellar/stellar-sdk";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  type Asset,
  type AssetOrderId,
  LocalAmount,
  type PayoutTerms,
  type PositiveAmount,
  baseAsset,
  precisionOf,
  sameAsset,
} from "../contract";
import { sandboxPartnerKeypair } from "../stellar/sandbox-partner";
import { WalletSettings } from "./settings.server";

export interface SettledPayout {
  readonly id: AssetOrderId;
  readonly terms: PayoutTerms;
  readonly settledAt: DateTime.Utc;
}

export class PayoutPartner extends Context.Service<
  PayoutPartner,
  {
    readonly depositAddress: AccountAddress;
    quote(
      asset: Asset,
      amount: PositiveAmount,
    ): Effect.Effect<Option.Option<LocalAmount>>;
    completedAt(
      payout: SettledPayout,
    ): Effect.Effect<Option.Option<DateTime.Utc>>;
  }
>()("@workspace/wallet/server/PayoutPartner") {
  static readonly depositingTo = (
    depositAddress: AccountAddress,
    completesAfter: Duration.Input,
  ) =>
    Layer.succeed(
      PayoutPartner,
      sandboxPartner(depositAddress, completesAfter),
    );

  static readonly sandbox = (completesAfter: Duration.Input) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const { feePayerSecret } = yield* WalletSettings;

        return PayoutPartner.depositingTo(
          Schema.decodeSync(AccountAddress)(
            sandboxPartnerKeypair(
              Keypair.fromSecret(Redacted.value(feePayerSecret)),
            ).publicKey(),
          ),
          completesAfter,
        );
      }),
    );
}

const sandboxCentimosPerDollar = 375n;

const sandboxPartner = (
  depositAddress: AccountAddress,
  completesAfter: Duration.Input,
) =>
  PayoutPartner.of({
    depositAddress,
    quote: (asset, amount) =>
      Effect.succeed(
        Option.some(
          (amount * sandboxCentimosPerDollar) /
            10n ** BigInt(precisionOf(asset).decimals),
        ).pipe(
          Option.filter(
            (minorUnits) => sameAsset(asset, baseAsset) && minorUnits > 0n,
          ),
          Option.map((minorUnits) =>
            LocalAmount.make({ currency: "PEN", minorUnits }),
          ),
        ),
      ),
    completedAt: ({ settledAt }) =>
      Effect.map(DateTime.now, (now) => {
        const completion = DateTime.addDuration(settledAt, completesAfter);

        return DateTime.isGreaterThanOrEqualTo(now, completion)
          ? Option.some(completion)
          : Option.none();
      }),
  });
