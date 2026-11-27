import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { AccountAddress, AssetOrderId, TransferId } from "../contract";
import { workFirstDelay, workRetryCeiling } from "../policy";

export class ReconcileTransfer extends Schema.TaggedClass<ReconcileTransfer>()(
  "ReconcileTransfer",
  { id: TransferId },
) {}

export class ReconcileAssetOrder extends Schema.TaggedClass<ReconcileAssetOrder>()(
  "ReconcileAssetOrder",
  { id: AssetOrderId },
) {}

export class CleanUpReceivedLink extends Schema.TaggedClass<CleanUpReceivedLink>()(
  "CleanUpReceivedLink",
  { id: AssetOrderId },
) {}

export class ReconcileOpening extends Schema.TaggedClass<ReconcileOpening>()(
  "ReconcileOpening",
  { address: AccountAddress },
) {}

export const PendingWork = Schema.Union([
  ReconcileTransfer,
  ReconcileOpening,
  ReconcileAssetOrder,
  CleanUpReceivedLink,
]);

export type PendingWork = typeof PendingWork.Type;

export class WorkFinished extends Schema.TaggedClass<WorkFinished>()(
  "WorkFinished",
  {},
) {}

export class WorkRetry extends Schema.TaggedClass<WorkRetry>()("WorkRetry", {
  delaySeconds: Schema.Number,
}) {}

export type WorkAttended = WorkFinished | WorkRetry;

export class QueueUnavailable extends Schema.TaggedError<QueueUnavailable>()(
  "QueueUnavailable",
  {
    cause: Schema.Defect(),
  },
) {}

export class WorkQueue extends Context.Service<
  WorkQueue,
  {
    send(
      work: PendingWork,
      delay: Duration.Duration,
    ): Effect.Effect<void, QueueUnavailable>;
  }
>()("@workspace/wallet/server/WorkQueue") {
  static readonly discarding = Layer.succeed(WorkQueue, {
    send: () => Effect.void,
  });
}

export const retryDelaySeconds = (attempt: number) =>
  Math.min(workFirstDelay * 2 ** Math.max(attempt - 1, 0), workRetryCeiling);

export const announcer = (queue: WorkQueue["Service"]) => (work: PendingWork) =>
  queue
    .send(work, Duration.seconds(workFirstDelay))
    .pipe(
      Effect.catch((failure) =>
        Effect.logWarning("Pending work could not be queued", failure),
      ),
    );
