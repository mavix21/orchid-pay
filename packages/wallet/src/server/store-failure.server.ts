import * as Schema from "effect/Schema";

export class StoreFailure extends Schema.TaggedError<StoreFailure>()(
  "StoreFailure",
  {
    cause: Schema.Defect(),
  },
) {}
