import { expect, it } from "vitest";

import { registerSenderLanguageOnServer } from "../src/locale/sender-language";
import { paraglideMiddleware } from "../src/paraglide/server";

registerSenderLanguageOnServer();

const servedLocale = async (path: string, headers: Record<string, string>) => {
  const response = await paraglideMiddleware(
    new Request(new URL(path, "https://orchid.test"), { headers }),
    ({ locale }) => new Response(locale),
  );

  return response.text();
};

it.each([
  ["a payment link with no cookie", "/r?lang=en", "es-PE", "", "en"],
  ["a Spanish sender's link", "/r?lang=es", "en-US", "", "es"],
  ["the recipient's choice", "/r?lang=en", "en-US", "locale=es", "es"],
  ["an unsupported cookie", "/r?lang=en", "es-PE", "locale=fr", "en"],
  ["an unsupported language", "/r?lang=fr", "en-US", "", "en"],
  ["a page that is not a payment link", "/home?lang=en", "es-PE", "", "es"],
])("%s is served in its language", async (_, path, browser, cookie, locale) => {
  await expect(
    servedLocale(path, { "accept-language": browser, cookie }),
  ).resolves.toBe(locale);
});
