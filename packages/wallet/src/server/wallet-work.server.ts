import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import { workSettlementGrace } from "../policy";
import type { AccountAddress, AssetOrderId, TransferId } from "../contract";
import {
  type AssetAuthorized,
  type AssetConcluded,
  AssetOrders,
} from "./AssetOrders.server";
import type { ChainUnreachable } from "./Chain.server";
import { Directory, type StoreFailure } from "./Directory.server";
import { type SealedOpening, sealedOpening } from "./opening-attempt.server";
import { type Authorized, Transfers } from "./Transfers.server";
import {
  type PendingWork,
  WorkFinished,
  WorkRetry,
  retryDelaySeconds,
} from "./work-queue.server";

export const workFlow = (actions: {
  readonly reconcileTransfer: (
    entry: Authorized,
  ) => Effect.Effect<boolean, StoreFailure | ChainUnreachable>;
  readonly reconcileOpening: (
    opening: SealedOpening,
  ) => Effect.Effect<boolean, StoreFailure | ChainUnreachable>;
  readonly reconcileAsset: (
    entry: AssetAuthorized,
  ) => Effect.Effect<boolean, StoreFailure | ChainUnreachable>;
  readonly cleanUpReceivedLink: (
    concluded: AssetConcluded,
  ) => Effect.Effect<boolean, StoreFailure | ChainUnreachable>;
}) =>
  Effect.gen(function* () {
    const transfers = yield* Transfers;
    const orders = yield* AssetOrders;
    const directory = yield* Directory;

    const retryUntilDecidable = Effect.fn("Wallet.retryUntilDecidable")(
      function* (expiresAt: DateTime.Utc, attempt: number) {
        const now = yield* DateTime.now;

        return DateTime.isGreaterThan(
          now,
          DateTime.add(expiresAt, { seconds: workSettlementGrace }),
        )
          ? new WorkFinished()
          : new WorkRetry({ delaySeconds: retryDelaySeconds(attempt) });
      },
    );

    const attendTransfer = Effect.fn("Wallet.attendTransfer")(function* (
      id: TransferId,
      attempt: number,
    ) {
      const found = yield* transfers.find(id);

      if (
        Option.isNone(found) ||
        !Predicate.isTagged(found.value, "Authorized")
      )
        return new WorkFinished();

      return (yield* actions.reconcileTransfer(found.value))
        ? yield* retryUntilDecidable(found.value.sealed.expiresAt, attempt)
        : new WorkFinished();
    });

    const attendOpening = Effect.fn("Wallet.attendOpening")(function* (
      address: AccountAddress,
      attempt: number,
    ) {
      const found = Option.flatMap(
        yield* directory.byAddress(address),
        sealedOpening,
      );

      if (Option.isNone(found)) return new WorkFinished();

      return (yield* actions.reconcileOpening(found.value))
        ? yield* retryUntilDecidable(found.value.sealed.expiresAt, attempt)
        : new WorkFinished();
    });

    const attendAssetOrder = Effect.fn("Wallet.attendAssetOrder")(function* (
      id: AssetOrderId,
      attempt: number,
    ) {
      const found = yield* orders.find(id);

      if (
        Option.isNone(found) ||
        !Predicate.isTagged(found.value, "AssetAuthorized")
      )
        return new WorkFinished();

      return (yield* actions.reconcileAsset(found.value))
        ? yield* retryUntilDecidable(found.value.sealed.expiresAt, attempt)
        : new WorkFinished();
    });

    const attendLinkCleanup = Effect.fn("Wallet.attendLinkCleanup")(function* (
      id: AssetOrderId,
      attempt: number,
    ) {
      const found = yield* orders.find(id);

      if (
        Option.isNone(found) ||
        !Predicate.isTagged(found.value, "AssetConcluded")
      )
        return new WorkFinished();

      return (yield* actions.cleanUpReceivedLink(found.value))
        ? new WorkFinished()
        : new WorkRetry({ delaySeconds: retryDelaySeconds(attempt) });
    });

    return (work: PendingWork, attempt: number) =>
      Match.valueTags(work, {
        ReconcileTransfer: ({ id }) => attendTransfer(id, attempt),
        ReconcileOpening: ({ address }) => attendOpening(address, attempt),
        ReconcileAssetOrder: ({ id }) => attendAssetOrder(id, attempt),
        CleanUpReceivedLink: ({ id }) => attendLinkCleanup(id, attempt),
      });
  });
