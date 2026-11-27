import * as Schema from "effect/Schema";

export class ChainUnreachable extends Schema.TaggedError<ChainUnreachable>()(
  "ChainUnreachable",
  {
    cause: Schema.Defect(),
  },
) {}
