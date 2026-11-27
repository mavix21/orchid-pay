import * as Schema from "effect/Schema";

export const humanCheckTokenMaxLength = 2048;

export const HumanCheckToken = Schema.NonEmptyString.check(
  Schema.isMaxLength(humanCheckTokenMaxLength),
).pipe(Schema.brand("HumanCheckToken"));

export type HumanCheckToken = typeof HumanCheckToken.Type;

export class HumanCheckRefused extends Schema.TaggedClass<HumanCheckRefused>()(
  "HumanCheckRefused",
  {},
) {}
