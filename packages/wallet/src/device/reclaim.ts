import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import {
  AssetOrder,
  AssetOrderId,
  ClaimUnclaimedFunds,
  type WalletPort,
  type WalletUnavailable,
} from "../contract";
import {
  type ClaimKind,
  type ClaimReviews,
  reviewedClaims,
} from "./claim-reviews";
import type {
  CorruptDeviceWallet,
  KeyStore,
  KeyStoreUnavailable,
} from "./key-store";
import {
  type ConfirmReclaimOutcome,
  NoWallet,
  type PaymentLinkTarget,
  type ReclaimReview,
  type ReviewReclaimOutcome,
} from "./outcomes";
import { reviewFromJson, reviewJson, reviewOf } from "./reclaim-reviews";
import { recordsStore, withoutReclaimed } from "./saved-links";

export function deviceReclaim(
  port: WalletPort,
  store: KeyStore,
  reviews: ClaimReviews,
) {
  const records = recordsStore(store, reviews.device?.store);

  const kind: ClaimKind<PaymentLinkTarget, ReclaimReview> = {
    reviewOf,
    targetOf: (shown) => shown,
    json: reviewJson,
    fromJson: reviewFromJson,
    concluded: (order, outcome) => {
      const { action } = order;

      return Predicate.isTagged(action, "ClaimUnclaimedFunds") &&
        (Predicate.isTagged(outcome, "AssetSettled") ||
          Predicate.isTagged(outcome, "UnclaimedFundsGone"))
        ? records
            .updateRecords(({ wallet, links }) =>
              wallet.address === order.wallet
                ? Option.some({
                    wallet,
                    links: withoutReclaimed(
                      links,
                      wallet.address,
                      action.unclaimedFunds,
                    ),
                  })
                : Option.none(),
            )
            .pipe(Effect.asVoid)
        : Effect.void;
    },
  };

  const claims = reviewedClaims(port, reviews, kind);

  const review = Effect.fn("Device.reviewReclaim")(function* (
    target: PaymentLinkTarget,
  ): Effect.fn.Return<
    ReviewReclaimOutcome,
    WalletUnavailable | KeyStoreUnavailable
  > {
    const stored = yield* store.readPublic();

    if (Option.isNone(stored)) return new NoWallet();

    const order = new AssetOrder({
      id: Schema.decodeSync(AssetOrderId)(crypto.randomUUID()),
      wallet: stored.value.address,
      action: ClaimUnclaimedFunds.make({
        unclaimedFunds: target.unclaimedFunds,
      }),
    });

    return yield* claims.review(stored.value, order, target);
  });

  const confirm = (
    shown: ReclaimReview,
  ): Effect.Effect<
    ConfirmReclaimOutcome,
    WalletUnavailable | KeyStoreUnavailable | CorruptDeviceWallet
  > => claims.confirm(shown);

  return { review, confirm };
}
