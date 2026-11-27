import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { WalletPort } from "../src/contract";
import { settleHash, world } from "./stellar-harness";

const settleLatest = () =>
  Effect.sync(() => {
    const sealed = world.submitted.at(-1);

    if (sealed) settleHash(sealed.hash);
  });

export const settlingOpenings = (wallet: WalletPort): WalletPort => ({
  ...wallet,
  enroll: (enrollment, approvals) =>
    wallet.enroll(enrollment, approvals).pipe(Effect.tap(settleLatest)),
  open: (claim, approvals) =>
    wallet.open(claim, approvals).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          const sealed = world.submitted.at(-1);

          if (Option.isSome(approvals) && sealed) settleHash(sealed.hash);
        }),
      ),
    ),
});
