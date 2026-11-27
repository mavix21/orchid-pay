import * as Match from "effect/Match";

import { m } from "@/paraglide/messages";
import type { Locale } from "@/paraglide/runtime";

export const languageName = (locale: Locale) =>
  Match.value(locale).pipe(
    Match.when("es", () => m.language_name_es()),
    Match.when("en", () => m.language_name_en()),
    Match.exhaustive,
  );
