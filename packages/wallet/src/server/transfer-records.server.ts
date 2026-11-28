import * as DateTime from "effect/DateTime";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  AccountAddress,
  Asset,
  UnclaimedFundsId,
  Failed,
  Pending,
  PositiveAmount,
  Profile,
  ResolvedRecipient,
  Settled,
  SigningRequest,
  TransferId,
  TransferOrder,
} from "../contract";
import { Sealed } from "./Chain.server";
import type { transfers } from "./tables.server";

export class Proposed extends Schema.TaggedClass<Proposed>()("Proposed", {
  order: TransferOrder,
  recipient: ResolvedRecipient,
  request: SigningRequest,
  unclaimedFunds: Schema.optional(UnclaimedFundsId),
  attemptUnclaimedFunds: Schema.Array(UnclaimedFundsId),
}) {}

export class Authorized extends Schema.TaggedClass<Authorized>()("Authorized", {
  order: TransferOrder,
  recipient: ResolvedRecipient,
  sealed: Sealed,
  unclaimedFunds: Schema.optional(UnclaimedFundsId),
  attemptUnclaimedFunds: Schema.Array(UnclaimedFundsId),
}) {}

export class Concluded extends Schema.TaggedClass<Concluded>()("Concluded", {
  order: TransferOrder,
  recipient: ResolvedRecipient,
  receipt: Schema.Union([Settled, Failed]),
}) {}

export class SlotTaken extends Schema.TaggedClass<SlotTaken>()("SlotTaken", {
  holder: Authorized,
}) {}

export class ClaimablesFull extends Schema.TaggedClass<ClaimablesFull>()(
  "ClaimablesFull",
  { limit: Schema.Number },
) {}

export class OpenLinkRecord extends Schema.Class<OpenLinkRecord>(
  "OpenLinkRecord",
)({
  id: TransferId,
  unclaimedFunds: UnclaimedFundsId,
  address: AccountAddress,
  asset: Asset,
  amount: PositiveAmount,
  createdAt: Schema.DateTimeUtcFromString,
}) {}

export class FundedLink extends Schema.Class<FundedLink>("FundedLink")({
  unclaimedFunds: UnclaimedFundsId,
  sender: Profile,
  asset: Asset,
  amount: PositiveAmount,
}) {}

export type Transfer = Proposed | Authorized | Concluded;

export type TransferRow = typeof transfers.$inferSelect;

export interface ConclusionColumns {
  readonly status: "settled" | "failed";
  readonly concludedAt: Date;
  readonly failure: "expired" | "rejected" | null;
}

export const OrderJson = Schema.fromJsonString(TransferOrder);
export const RecipientJson = Schema.fromJsonString(ResolvedRecipient);

export const AttemptsJson = Schema.fromJsonString(
  Schema.Array(UnclaimedFundsId),
);

export const claimableKindOf = (
  unclaimedFunds: Option.Option<UnclaimedFundsId>,
): "paymentLink" | null =>
  Option.isNone(unclaimedFunds) ? null : "paymentLink";

export const appendAttempt = (
  existing: ReadonlyArray<UnclaimedFundsId>,
  unclaimedFunds: Option.Option<UnclaimedFundsId>,
): ReadonlyArray<UnclaimedFundsId> =>
  Option.match(unclaimedFunds, {
    onNone: () => existing,
    onSome: (id) => (existing.includes(id) ? existing : [...existing, id]),
  });

export function pending(transfer: Authorized): Pending {
  return new Pending({
    ...transfer.order,
    recipient: transfer.recipient,
    unclaimedFunds: transfer.unclaimedFunds,
    expiresAt: transfer.sealed.expiresAt,
  });
}

export function readTransferRow(row: TransferRow): Transfer {
  const order = Schema.decodeSync(OrderJson)(row.order);
  const recipient = Schema.decodeSync(RecipientJson)(row.resolvedRecipient);
  const expiresAt = DateTime.makeUnsafe(row.expiresAt);

  const unclaimedFunds =
    row.balanceId === null
      ? undefined
      : Schema.decodeSync(UnclaimedFundsId)(row.balanceId);

  const attemptUnclaimedFunds =
    row.attemptBalanceIds === null
      ? unclaimedFunds === undefined
        ? []
        : [unclaimedFunds]
      : Schema.decodeSync(AttemptsJson)(row.attemptBalanceIds);

  const fields = {
    order,
    recipient,
    unclaimedFunds,
    attemptUnclaimedFunds,
  };

  return Match.value(row.status).pipe(
    Match.when(
      "proposed",
      () =>
        new Proposed({
          ...fields,
          request: new SigningRequest({
            envelope: Schema.decodeSync(SigningRequest.fields.envelope)(
              row.envelope,
            ),
            expiresAt,
          }),
        }),
    ),
    Match.when("authorized", () => {
      if (!row.hash) throw new Error("Authorized transfer missing hash");

      return new Authorized({
        ...fields,
        sealed: new Sealed({
          envelope: row.envelope,
          hash: row.hash,
          expiresAt,
        }),
      });
    }),
    Match.when("settled", () => {
      if (!row.concludedAt)
        throw new Error("Settled transfer missing ledger time");

      return new Concluded({
        order,
        recipient,
        receipt: new Settled({
          ...order,
          recipient,
          unclaimedFunds,
          settledAt: DateTime.makeUnsafe(row.concludedAt),
        }),
      });
    }),
    Match.when("failed", () => {
      if (!row.failure) throw new Error("Failed transfer missing reason");

      return new Concluded({
        order,
        recipient,
        receipt: new Failed({
          ...order,
          recipient,
          unclaimedFunds,
          reason: row.failure,
        }),
      });
    }),
    Match.exhaustive,
  );
}
