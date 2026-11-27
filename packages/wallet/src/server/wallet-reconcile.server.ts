import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import { Chain } from "./Chain.server";
import { type Authorized, Transfers, pending } from "./Transfers.server";
import { paymentLinksFlow } from "./wallet-payment-links.server";

export const transferReconcileFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const transfers = yield* Transfers;
  const links = yield* paymentLinksFlow;

  return Effect.fn("Wallet.reconcile")(function* (authorized: Authorized) {
    const settlement = yield* chain.settlement(authorized.sealed);

    return yield* Match.valueTags(settlement, {
      Applied: (evidence) =>
        transfers
          .conclude(authorized.order.id, evidence)
          .pipe(Effect.map((done) => done.receipt)),
      Rejected: (evidence) =>
        transfers
          .conclude(authorized.order.id, evidence)
          .pipe(Effect.map((done) => done.receipt)),
      Expired: (evidence) =>
        transfers
          .conclude(authorized.order.id, evidence)
          .pipe(Effect.map((done) => done.receipt)),
      Undecided: () =>
        Effect.gen(function* () {
          const liveEvidence = yield* links.reconcileLiveLink(authorized);

          if (Option.isSome(liveEvidence))
            return (yield* transfers.conclude(
              authorized.order.id,
              liveEvidence.value,
            )).receipt;

          yield* chain.submit(authorized.sealed).pipe(Effect.ignore);

          return pending(authorized);
        }),
    });
  });
});
