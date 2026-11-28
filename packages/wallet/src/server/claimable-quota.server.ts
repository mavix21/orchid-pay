import * as Effect from "effect/Effect";
import type { AccountAddress, UnclaimedFundsId } from "../contract";
import { claimableQuota } from "../policy";
import { Chain, type ChainUnreachable } from "./Chain.server";
import type { StoreFailure } from "./Directory.server";
import { rpcReadConcurrency } from "./settings.server";
import { type ClaimableKind, Transfers } from "./Transfers.server";

export type QuotaCheck = (
  sender: AccountAddress,
  kind: ClaimableKind,
) => Effect.Effect<boolean, StoreFailure | ChainUnreachable>;

export const claimableQuotaFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const transfers = yield* Transfers;

  const closeGoneUnclaimedFunds = (id: UnclaimedFundsId) =>
    chain
      .unclaimedFunds([id])
      .pipe(
        Effect.flatMap((confirmed) =>
          confirmed.length === 0
            ? chain
                .unclaimedFundsClosedAt(id)
                .pipe(
                  Effect.flatMap((closedAt) =>
                    transfers.closeUnclaimedFunds(id, closedAt),
                  ),
                )
            : Effect.void,
        ),
      );

  const quotaReached = Effect.fn("Wallet.claimableQuotaReached")(function* (
    sender: AccountAddress,
    kind: ClaimableKind,
  ) {
    return (
      (yield* transfers.openClaimables(sender, kind)) >= claimableQuota[kind]
    );
  });

  const quotaFull = Effect.fn("Wallet.claimableQuotaFull")(function* (
    sender: AccountAddress,
    kind: ClaimableKind,
  ) {
    if (!(yield* quotaReached(sender, kind))) return false;

    yield* Effect.forEach(
      yield* transfers.settledOpenUnclaimedFunds(sender, kind),
      closeGoneUnclaimedFunds,
      { concurrency: rpcReadConcurrency, discard: true },
    );

    return yield* quotaReached(sender, kind);
  });

  return { closeGoneUnclaimedFunds, quotaFull, quotaReached };
});
