import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { AccountAddress, SigningRequest } from "../contract";
import { approvalMargin } from "../policy";
import { Chain } from "./Chain.server";

export const live = (request: SigningRequest) =>
  Effect.map(
    Clock.currentTimeMillis,
    (now) =>
      DateTime.toEpochMillis(request.expiresAt) > now + approvalMargin * 1000,
  );

export const confirmedReads = Effect.gen(function* () {
  const chain = yield* Chain;

  const readStanding = Effect.fn("Wallet.readStanding")(function* (
    address: AccountAddress,
  ) {
    const first = yield* chain.standing(address);

    return first === "open" || first === "foreign"
      ? first
      : yield* chain.standing(address);
  });

  const readBalance = Effect.fn("Wallet.readBalance")(function* (
    address: AccountAddress,
  ) {
    const first = yield* chain.balance(address);

    return Option.isNone(first) ? yield* chain.balance(address) : first;
  });

  return { readStanding, readBalance };
});
