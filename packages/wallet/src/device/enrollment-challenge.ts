import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Result from "effect/Result";
import {
  ChallengeIssued,
  InvalidResponse,
  type WalletClaim,
  type WalletPort,
} from "../contract";
import type { EnrollWalletOutcome } from "./enrollment-records";

export const enrollmentChallenge = Effect.fn("Device.enrollmentChallenge")(
  function* (
    port: Pick<WalletPort, "enrollmentChallenge">,
    claim: WalletClaim,
  ): Effect.fn.Return<ChallengeIssued | EnrollWalletOutcome> {
    const issued = yield* port.enrollmentChallenge(claim).pipe(Effect.result);

    if (Result.isFailure(issued)) return issued.failure;

    const step = issued.success;

    if (step instanceof ChallengeIssued) return step;

    return Match.valueTags(step, {
      UsernameTaken: (taken): EnrollWalletOutcome => taken,
      HumanCheckRefused: (refused): EnrollWalletOutcome => refused,
      AddressBound: (): EnrollWalletOutcome => new InvalidResponse(),
    });
  },
);
