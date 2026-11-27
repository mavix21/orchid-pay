import * as Effect from "effect/Effect";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import {
  InvalidResponse,
  type OpenStep,
  type UsernameTaken,
  type WalletPort,
  type WalletUnavailable,
} from "../contract";
import {
  type Awaiting,
  addressOf,
  claimOf,
  standingOfReview,
  usernameOf,
} from "./enrollment-state";
import { OpeningReview } from "./outcomes";

export const enrollmentReviewRequest = (port: Pick<WalletPort, "open">) =>
  Effect.fn("Device.requestEnrollmentReview")(function* (
    current: Awaiting,
    redrafted: boolean,
  ): Effect.fn.Return<
    OpeningReview | UsernameTaken | InvalidResponse,
    WalletUnavailable
  > {
    const step: OpenStep = yield* port.open(claimOf(current), Option.none());

    const unexpected = () => Effect.succeed(new InvalidResponse());

    return yield* Match.valueTags(step, {
      OpeningDraft: (draft) => {
        const review = new OpeningReview({
          username: usernameOf(current),
          address: addressOf(current),
          draft,
          redrafted,
        });

        return Effect.map(standingOfReview(current, review), (standing) =>
          standing === "current" ? review : new InvalidResponse(),
        );
      },
      UsernameTaken: Effect.succeed,
      HumanCheckRefused: unexpected,
      OpeningPending: unexpected,
      Opened: unexpected,
      AddressBound: unexpected,
      InvalidAddress: unexpected,
      NotSponsored: unexpected,
    });
  });
