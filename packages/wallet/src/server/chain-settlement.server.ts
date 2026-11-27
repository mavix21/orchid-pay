import * as Schema from "effect/Schema";

export class Sealed extends Schema.Class<Sealed>("Sealed")({
  envelope: Schema.String,
  hash: Schema.String,
  expiresAt: Schema.DateTimeUtcFromString,
}) {}

export class Applied extends Schema.TaggedClass<Applied>()("Applied", {
  at: Schema.DateTimeUtcFromString,
}) {}

export class Rejected extends Schema.TaggedClass<Rejected>()("Rejected", {
  code: Schema.String,
}) {}

export class Expired extends Schema.TaggedClass<Expired>()("Expired", {}) {}

export class Undecided extends Schema.TaggedClass<Undecided>()(
  "Undecided",
  {},
) {}

export type Settlement = Applied | Rejected | Expired | Undecided;
