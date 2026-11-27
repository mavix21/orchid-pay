import { type PetalTip, petalTips } from "@/flower/petal";

export type Eye =
  | "dot"
  | "happy"
  | "sleepy"
  | "squintLeft"
  | "squintRight"
  | "v"
  | "sparkle";

export type Mouth =
  | "smile"
  | "o"
  | "open"
  | "cat"
  | "tongue"
  | "tiny"
  | "tooth";

export type Shade = "mid" | "light" | "deep";

export type Swirl = "left" | "straight" | "right";

export type Lobes = "deep" | "soft";

export type Flower = {
  readonly petals: number;
  readonly tip: PetalTip;
  readonly fullness: number;
  readonly rotation: number;
  readonly hue: number;
  readonly shade: Shade;
  readonly swirl: Swirl;
  readonly lobes: Lobes;
  readonly eyes: readonly [Eye, Eye];
  readonly mouth: Mouth;
  readonly blush: boolean;
  readonly tilt: number;
};

type Options<T> = readonly [T, ...ReadonlyArray<T>];

const eyePairs: Options<readonly [Eye, Eye]> = [
  ["dot", "dot"],
  ["happy", "happy"],
  ["sleepy", "sleepy"],
  ["squintLeft", "squintRight"],
  ["v", "v"],
  ["sparkle", "sparkle"],
  ["dot", "happy"],
  ["sparkle", "happy"],
];

const mouths: Options<Mouth> = [
  "smile",
  "o",
  "open",
  "cat",
  "tongue",
  "tiny",
  "tooth",
];

const wideTips: Options<PetalTip> = ["round", "notched", "teardrop"];

const allTips: Options<PetalTip> = petalTips;

const fewestPetals = 5;

const mostPetals = 12;

const fewestPointedPetals = 7;

const fewestSoftLobedPetals = 8;

const fewestSwirledPetals = 7;

const firstHue = 270;

const hueSpan = 150;

const tiltSpan = 16;

const unitOf = (text: string) => {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;

  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;

    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }

  first =
    Math.imul(first ^ (first >>> 16), 2246822507) ^
    Math.imul(second ^ (second >>> 13), 3266489909);

  return (first >>> 0) / 2 ** 32;
};

const choose = <T>(options: Options<T>, unit: number) =>
  options[Math.floor(unit * options.length)] ?? options[0];

export function flowerOf(username: string): Flower {
  const trait = (name: string) => unitOf(`${name}:${username}`);

  const petals =
    fewestPetals +
    Math.floor(trait("petals") * (mostPetals - fewestPetals + 1));

  const tip = choose(
    petals >= fewestPointedPetals ? allTips : wideTips,
    trait("tip"),
  );

  const swirls = petals >= fewestSwirledPetals || tip === "round";

  return {
    petals,
    tip,
    fullness: choose([1, 1.2], trait("fullness")),
    rotation: trait("rotation") * 360,
    hue: (firstHue + trait("hue") * hueSpan) % 360,
    shade: choose(["mid", "light", "deep"], trait("shade")),
    swirl: swirls
      ? choose(["left", "straight", "right"], trait("swirl"))
      : "straight",
    lobes:
      petals >= fewestSoftLobedPetals
        ? choose(["deep", "soft"], trait("lobes"))
        : "deep",
    eyes: choose(eyePairs, trait("eyes")),
    mouth: choose(mouths, trait("mouth")),
    blush: trait("blush") < 0.5,
    tilt: (trait("tilt") - 0.5) * tiltSpan,
  };
}
