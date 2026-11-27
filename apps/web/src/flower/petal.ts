type Point = readonly [x: number, y: number];

type Curve = readonly [Point, Point, Point];

export const petalTips = ["round", "pointed", "notched", "teardrop"] as const;

export type PetalTip = (typeof petalTips)[number];

export const petalLength = 44;

const sealedFrom = 0.45;

const outlines = {
  round: [
    [
      [1, -0.12],
      [1.08, -1],
      [0, -1],
    ],
  ],
  pointed: [
    [
      [1.25, -0.3],
      [0.6, -0.78],
      [0, -1],
    ],
  ],
  notched: [
    [
      [1.1, -0.2],
      [1.15, -1],
      [0.45, -1],
    ],
    [
      [0.2033, -1],
      [0.0533, -0.9533],
      [0, -0.86],
    ],
  ],
  teardrop: [
    [
      [0.3, -0.3],
      [1.3, -0.5],
      [0.95, -0.84],
    ],
    [
      [0.8, -0.95],
      [0.4, -1.005],
      [0, -1.005],
    ],
  ],
} satisfies Record<PetalTip, ReadonlyArray<Curve>>;

const origin: Point = [0, 0];

const startsOf = (curves: ReadonlyArray<Curve>): ReadonlyArray<Point> => [
  origin,
  ...curves.map(([, , end]) => end),
];

const cubicAt = (start: Point, [first, second, end]: Curve, t: number) => {
  const rest = 1 - t;

  const weights = [rest ** 3, 3 * rest ** 2 * t, 3 * rest * t ** 2, t ** 3];

  const points = [start, first, second, end];

  return points.reduce<Point>(
    ([x, y], [px, py], index) => [
      x + px * (weights[index] ?? 0),
      y + py * (weights[index] ?? 0),
    ],
    origin,
  );
};

const samplesPerCurve = 240;

const halfWidthsOf = (tip: PetalTip) => {
  const curves = outlines[tip];

  const starts = startsOf(curves);

  const halfWidths = new Map<number, number>();

  curves.forEach((curve, index) => {
    const start = starts[index] ?? origin;

    Array.from({ length: samplesPerCurve + 1 }, (_, step) =>
      cubicAt(start, curve, step / samplesPerCurve),
    ).forEach(([x, y]) => {
      const depth = Math.round(-y * petalLength);

      halfWidths.set(depth, Math.max(halfWidths.get(depth) ?? 0, x));
    });
  });

  return halfWidths;
};

const halfWidths = new Map(petalTips.map((tip) => [tip, halfWidthsOf(tip)]));

export function sealedWidth(tip: PetalTip, count: number, sealedTo: number) {
  const profile = halfWidths.get(tip) ?? new Map<number, number>();

  const gap = Math.tan(Math.PI / count);

  const from = Math.round(petalLength * sealedFrom);

  const to = Math.round(petalLength * sealedTo);

  return Math.max(
    ...Array.from({ length: to - from + 1 }, (_, offset) => {
      const depth = from + offset;

      return (depth * gap) / (profile.get(depth) ?? 1);
    }),
  );
}

const coordinate = (value: number) => value.toFixed(2);

export function petalPath(tip: PetalTip, width: number) {
  const curves = outlines[tip];

  const starts = startsOf(curves);

  const placed = ([x, y]: Point, side: 1 | -1) =>
    `${coordinate(x * width * side)} ${coordinate(y * petalLength)}`;

  const right = curves.map(
    ([first, second, end]) =>
      `C${placed(first, 1)} ${placed(second, 1)} ${placed(end, 1)}`,
  );

  const left = curves
    .map(
      ([first, second], index) =>
        `C${placed(second, -1)} ${placed(first, -1)} ${placed(starts[index] ?? origin, -1)}`,
    )
    .reverse();

  return `M0 0 ${[...right, ...left].join(" ")}Z`;
}
