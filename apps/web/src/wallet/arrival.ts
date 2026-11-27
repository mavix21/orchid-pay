import type { UnclaimedFunds, DeviceOverview } from "@workspace/wallet";
import * as Arr from "effect/Array";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import { amountLabel } from "@/send/money";
import { m } from "@/paraglide/messages";

export const arrivalOf = (
  overview: DeviceOverview,
): Option.Option<UnclaimedFunds> =>
  Predicate.isTagged(overview, "Holding")
    ? Arr.findLast(
        overview.unclaimedFunds,
        (entry) => entry.to.address === overview.profile.address,
      )
    : Option.none();

export const arrivalSentence = (payment: UnclaimedFunds) =>
  m.arrival_sentence({
    username: payment.from.username,
    amount: amountLabel(payment.amount, payment.asset),
  });
