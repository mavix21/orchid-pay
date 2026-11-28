import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Profile } from "./identity";

export class NotOpened extends Schema.TaggedClass<NotOpened>()("NotOpened", {
  profile: Schema.OptionFromNullOr(Profile).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
    Schema.withConstructorDefault(Effect.succeed(Option.none())),
  ),
}) {}

export class NeedsReopening extends Schema.TaggedClass<NeedsReopening>()(
  "NeedsReopening",
  {
    profile: Profile,
  },
) {}
