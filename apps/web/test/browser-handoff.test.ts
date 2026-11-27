import { expect, it } from "vitest";

import { androidDefaultBrowserLink } from "../src/browser/support";

const destinationOf = (intentUrl: string) => {
  const intentStart = intentUrl.lastIndexOf("#");
  const intentSpec = intentUrl.slice(intentStart);
  const scheme = /^#Intent;scheme=(\w+);end$/.exec(intentSpec)?.[1];

  return `${scheme}:${intentUrl.slice("intent:".length, intentStart)}`;
};

it("the Android handoff reopens the same path, query and fragment", () => {
  const destination = "https://orchid.example/p/abc?via=ig#frag/with#hash";

  expect(destinationOf(androidDefaultBrowserLink(destination))).toBe(
    destination,
  );
});
