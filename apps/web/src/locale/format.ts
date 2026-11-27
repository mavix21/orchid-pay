import * as Match from "effect/Match";

import { getLocale } from "@/paraglide/runtime";

export const formattingLocale = () =>
  Match.value(getLocale()).pipe(
    Match.when("es", () => "es-PE"),
    Match.when("en", () => "en-US"),
    Match.exhaustive,
  );
