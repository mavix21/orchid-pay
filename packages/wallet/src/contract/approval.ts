import * as Schema from "effect/Schema";

export const UnsignedEnvelope = Schema.String.pipe(
  Schema.brand("UnsignedEnvelope"),
);

export type UnsignedEnvelope = typeof UnsignedEnvelope.Type;

export class SigningRequest extends Schema.Class<SigningRequest>(
  "@workspace/wallet/SigningRequest",
)({
  envelope: UnsignedEnvelope,
  expiresAt: Schema.DateTimeUtcFromString,
}) {}

export class Approval extends Schema.Class<Approval>(
  "@workspace/wallet/Approval",
)({
  signature: Schema.Uint8ArrayFromBase64,
}) {}

export const Approvals = Schema.NonEmptyArray(Approval);

export type Approvals = typeof Approvals.Type;
