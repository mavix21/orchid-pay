import {
  PendingWork,
  QueueUnavailable,
  WorkQueue,
} from "@workspace/wallet/server";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export const workQueueLayer = (queue: Queue) =>
  Layer.succeed(WorkQueue, {
    send: (work, delay) =>
      Schema.encodeEffect(PendingWork)(work).pipe(
        Effect.flatMap((body) =>
          Effect.tryPromise(() =>
            queue.send(body, { delaySeconds: Duration.toSeconds(delay) }),
          ),
        ),
        Effect.mapError((cause) => new QueueUnavailable({ cause })),
      ),
  });
