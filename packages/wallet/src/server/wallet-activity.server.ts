import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  type AccountAddress,
  type ActivityCursor,
  type ActivityStep,
  InvalidAddress,
  NotOpened,
} from "../contract";
import { Chain } from "./Chain.server";
import { Directory, type StoreFailure } from "./Directory.server";
import { Transfers } from "./Transfers.server";
import { depositFlow } from "./wallet-deposits.server";

export const activityFlow = Effect.gen(function* () {
  const chain = yield* Chain;
  const directory = yield* Directory;
  const transfers = yield* Transfers;
  const { catchUp } = yield* depositFlow;

  return Effect.fn("Wallet.activity")(function* (
    address: AccountAddress,
    before: ActivityCursor | undefined,
  ): Effect.fn.Return<ActivityStep, StoreFailure> {
    if (!chain.validAddress(address)) return new InvalidAddress({ address });

    const row = yield* directory.byAddress(address);

    if (Option.isNone(row) || row.value.status !== "active")
      return new NotOpened();

    if (before === undefined) yield* catchUp(address);

    return yield* transfers.activity(
      address,
      chain.destinationPrefixesPayingInto(address),
      before,
    );
  });
});
