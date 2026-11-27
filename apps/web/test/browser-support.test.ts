import { expect, it } from "vitest";

import { classifyBrowser } from "../src/browser/support";

const iPhone = (osVersion: string) =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS ${osVersion} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1`;

const iPadDesktopMode = (safariVersion: string) =>
  `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${safariVersion} Safari/605.1.15`;

const tikTokOnAndroid =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 trill_330000 AppName/trill";

it.each([
  ["an iPhone on iOS 18.3", iPhone("18_3"), 5, "OutdatedIos"],
  ["an iPhone on iOS 18.4", iPhone("18_4"), 5, "Supported"],
  [
    "an iPad in desktop mode on 18.3",
    iPadDesktopMode("18.3"),
    5,
    "OutdatedIos",
  ],
  ["an iPad in desktop mode on 18.4", iPadDesktopMode("18.4"), 5, "Supported"],
  ["a Mac with Safari 18.3", iPadDesktopMode("18.3"), 0, "Supported"],
  ["TikTok on Android", tikTokOnAndroid, 5, "EmbeddedBrowser"],
])("%s is classified %s", (_device, userAgent, touchPoints, expected) => {
  expect(classifyBrowser(userAgent, touchPoints)._tag).toBe(expected);
});
