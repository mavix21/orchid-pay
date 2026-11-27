import {
  type Locale,
  cookieName,
  defineCustomClientStrategy,
  defineCustomServerStrategy,
  isLocale,
  toLocale,
} from "@/paraglide/runtime";

const parameter = "lang";
const strategy = "custom-senderLanguage";
const paymentLinkPage = "/r";

export const senderLanguageQuery = (locale: Locale) =>
  new URLSearchParams([[parameter, locale]]).toString();

export const inSenderLanguage = (url: URL, locale: Locale) => {
  const carried = new URL(url);

  carried.searchParams.set(parameter, locale);

  return carried;
};

const senderLocale = (url: URL) => {
  const carried = url.searchParams.get(parameter);

  return url.pathname === paymentLinkPage && isLocale(carried)
    ? carried
    : undefined;
};

const chosenLocale = (request: Request) => {
  const prefix = `${cookieName}=`;

  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));

  return toLocale(cookie?.slice(prefix.length));
};

export const registerSenderLanguageOnServer = () =>
  defineCustomServerStrategy(strategy, {
    getLocale: (request) =>
      request === undefined || chosenLocale(request) !== undefined
        ? undefined
        : senderLocale(new URL(request.url)),
  });

export const registerSenderLanguageInBrowser = () =>
  defineCustomClientStrategy(strategy, {
    getLocale: () => senderLocale(new URL(window.location.href)),
    setLocale: () => undefined,
  });
