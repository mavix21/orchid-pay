import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { OpeningDraft, SigningRequest } from "../contract";
import { Sealed } from "./Chain.server";
import type { wallets } from "./tables.server";

type WalletRow = typeof wallets.$inferSelect;

export function openingAttempt(
  row: WalletRow,
): Option.Option<OpeningDraft | Sealed> {
  if (!row.attemptEnvelope || !row.attemptExpiresAt) return Option.none();

  const expiresAt = DateTime.makeUnsafe(row.attemptExpiresAt);

  if (row.attemptHash)
    return Option.some(
      new Sealed({
        envelope: row.attemptEnvelope,
        hash: row.attemptHash,
        expiresAt,
      }),
    );

  return Option.some(
    new OpeningDraft({
      request: new SigningRequest({
        envelope: Schema.decodeSync(SigningRequest.fields.envelope)(
          row.attemptEnvelope,
        ),
        expiresAt,
      }),
    }),
  );
}

export interface SealedOpening {
  readonly row: WalletRow;
  readonly sealed: Sealed;
}

export const sealedOpening = (row: WalletRow): Option.Option<SealedOpening> =>
  row.status === "active"
    ? Option.none()
    : openingAttempt(row).pipe(
        Option.filter((attempt) => attempt instanceof Sealed),
        Option.map((sealed) => ({ row, sealed })),
      );
