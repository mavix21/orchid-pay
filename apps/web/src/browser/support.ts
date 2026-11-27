import * as Data from "effect/Data";

export type EmbeddedApp = "Instagram" | "Facebook" | "TikTok" | "WhatsApp";

export type DevicePlatform = "android" | "ios" | "other";

export type BrowserSupport = Data.TaggedEnum<{
  Supported: {};
  EmbeddedBrowser: {
    readonly app: EmbeddedApp;
    readonly platform: DevicePlatform;
  };
  OutdatedIos: {};
}>;

export const BrowserSupport = Data.taggedEnum<BrowserSupport>();

const embeddedApps: ReadonlyArray<readonly [EmbeddedApp, RegExp]> = [
  ["Instagram", /Instagram/],
  ["Facebook", /FBAN|FBAV|FB_IAB/],
  ["TikTok", /BytedanceWebview|musical_ly|trill_|AppName\/trill/],
  ["WhatsApp", /WhatsApp/],
];

const minimumIosVersion = { major: 18, minor: 4 };

const isIpadWithDesktopUserAgent = (
  userAgent: string,
  maxTouchPoints: number,
) => /Macintosh/.test(userAgent) && maxTouchPoints > 1;

const platformOf = (
  userAgent: string,
  maxTouchPoints: number,
): DevicePlatform =>
  /iPhone|iPad|iPod/.test(userAgent) ||
  isIpadWithDesktopUserAgent(userAgent, maxTouchPoints)
    ? "ios"
    : /Android/.test(userAgent)
      ? "android"
      : "other";

const iosVersionOf = (userAgent: string, maxTouchPoints: number) =>
  isIpadWithDesktopUserAgent(userAgent, maxTouchPoints)
    ? /Version\/(\d+)\.(\d+)/.exec(userAgent)
    : /(?:iPhone|CPU) OS (\d+)_(\d+)/.exec(userAgent);

const isOutdatedIos = (userAgent: string, maxTouchPoints: number) => {
  const version = iosVersionOf(userAgent, maxTouchPoints);

  if (version === null) return false;

  const major = Number(version[1]);
  const minor = Number(version[2]);

  return (
    major < minimumIosVersion.major ||
    (major === minimumIosVersion.major && minor < minimumIosVersion.minor)
  );
};

export function classifyBrowser(
  userAgent: string,
  maxTouchPoints: number,
): BrowserSupport {
  if (isOutdatedIos(userAgent, maxTouchPoints))
    return BrowserSupport.OutdatedIos();

  const embedded = embeddedApps.find(([, marker]) => marker.test(userAgent));

  return embedded === undefined
    ? BrowserSupport.Supported()
    : BrowserSupport.EmbeddedBrowser({
        app: embedded[0],
        platform: platformOf(userAgent, maxTouchPoints),
      });
}

export function androidDefaultBrowserLink(destination: string) {
  const url = new URL(destination);

  return `intent://${url.host}${url.pathname}${url.search}${url.hash}#Intent;scheme=${url.protocol.slice(0, -1)};end`;
}
