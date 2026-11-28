import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  type AccountAddress,
  type Asset,
  type AssetOrderId,
  LocalAmount,
  type LocalCurrency,
  type PayoutTerms,
  type PositiveAmount,
  baseAsset,
  precisionOf,
  sameAsset,
} from "../contract";
import { sandboxDepositAddress } from "../binding/chain.server";
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
      currency: LocalCurrency,
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
        const settings = yield* WalletSettings;

        return PayoutPartner.depositingTo(
          sandboxDepositAddress(settings),
          completesAfter,
        );
      }),
    );
}

const sandboxMinorUnitsPerDollar: Record<LocalCurrency, bigint> = {
  PEN: 375n,
  COP: 400_000n,
  BRL: 540n,
  MXN: 1_850n,
};

const sandboxPartner = (
  depositAddress: AccountAddress,
  completesAfter: Duration.Input,
) =>
  PayoutPartner.of({
    depositAddress,
    quote: (asset, amount, currency) =>
      Effect.succeed(
        Option.some(
          (amount * sandboxMinorUnitsPerDollar[currency]) /
            10n ** BigInt(precisionOf(asset).decimals),
        ).pipe(
          Option.filter(
            (minorUnits) => sameAsset(asset, baseAsset) && minorUnits > 0n,
          ),
          Option.map((minorUnits) =>
            LocalAmount.make({ currency, minorUnits }),
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
