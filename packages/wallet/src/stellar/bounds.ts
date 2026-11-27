import * as Schema from "effect/Schema";

export const bounds = {
  sequence: Schema.String,
  minTime: Schema.Number,
  maxTime: Schema.Number,
};
