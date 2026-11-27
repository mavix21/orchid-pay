import {
  PendingWork,
  Wallet,
  retryDelaySeconds,
} from "@workspace/wallet/server";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { runWallet } from "./wallet.server";

export const attendMessage = async (message: Message) => {
  const work = Schema.decodeUnknownOption(PendingWork)(message.body);

  if (Option.isNone(work)) {
    await Effect.runPromise(
      Effect.logError("Pending work message is unreadable"),
    );

    return message.ack();
  }

  const attended = await runWallet(
    Wallet.use((wallet) => wallet.attend(work.value, message.attempts)),
  ).catch(() => undefined);

  if (attended === undefined)
    return message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });

  return Predicate.isTagged(attended, "WorkRetry")
    ? message.retry({ delaySeconds: attended.delaySeconds })
    : message.ack();
};
