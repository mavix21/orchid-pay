import { expect, it } from "vitest";

import { flowerOf } from "../src/flower/flower";

it("draws the same flower for a username across releases", () => {
  expect(flowerOf("mariarojas")).toEqual({
    petals: 8,
    tip: "pointed",
    fullness: 1,
    rotation: 322.91984765790403,
    hue: 22.25504142930731,
    shade: "light",
    swirl: "left",
    lobes: "soft",
    eyes: ["v", "v"],
    mouth: "o",
    blush: false,
    tilt: -4.009434048086405,
  });
});
