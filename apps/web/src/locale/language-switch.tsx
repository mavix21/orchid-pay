import { LanguagesIcon } from "lucide-react";
import { Button } from "@workspace/ui/components/button";

import { languageName } from "@/locale/language-name";
import { m } from "@/paraglide/messages";
import { getLocale, locales, setLocale } from "@/paraglide/runtime";

export function LanguageSwitch() {
  const current = getLocale();
  const next = locales.find((locale) => locale !== current) ?? current;

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={m.language_switch_label()}
      data-testid="language-switch"
      onClick={() => setLocale(next)}
    >
      <LanguagesIcon />
      <span lang={next}>{languageName(next)}</span>
    </Button>
  );
}
