import { type CashOut, cashOutAt } from "./cash-out-methods";
import { landMask } from "./land-mask";

const cycleMilliseconds = 3500;

const turnMilliseconds = 750;

const landingLift = 48;

const flightStart = 850;

const flightEnd = 2150;

const radians = Math.PI / 180;

const landCells = Uint8Array.from(atob(landMask.cells), (character) =>
  character.charCodeAt(0),
);

const landDots = Array.from({ length: landMask.rows }, (_, row) => {
  const latitude = landMask.south + (row + 0.5) * landMask.step;
  const stride = Math.max(1, Math.round(1 / Math.cos(latitude * radians)));

  return Array.from({ length: landMask.columns }, (_, column) => column)
    .filter((column) => column % stride === 0)
    .filter((column) => {
      const cell = row * landMask.columns + column;

      return ((landCells[cell >> 3] ?? 0) >> (cell & 7)) & 1;
    })
    .flatMap((column) => [
      landMask.west + (column + 0.5) * landMask.step,
      latitude,
    ]);
}).flat();

type View = { longitude: number; latitude: number };

type Projected = { x: number; y: number; depth: number };

export type Palette = {
  surface: string;
  ink: string;
  accent: string;
};

const viewOf = (cashOut: CashOut): View => ({
  longitude: cashOut.longitude - 22,
  latitude: Math.max(-12, Math.min(28, cashOut.latitude * 0.6 + 12)),
});

const easeInOutCubic = (progress: number) =>
  progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const shortestTurn = (from: number, to: number) =>
  ((((to - from) % 360) + 540) % 360) - 180;

const blendViews = (from: View, to: View, progress: number): View => ({
  longitude:
    from.longitude + shortestTurn(from.longitude, to.longitude) * progress,
  latitude: from.latitude + (to.latitude - from.latitude) * progress,
});

const project = (
  view: View,
  longitude: number,
  latitude: number,
  radius: number,
): Projected => {
  const parallel = latitude * radians;
  const meridian = (longitude - view.longitude) * radians;
  const tilt = view.latitude * radians;
  const spread = Math.cos(parallel);

  return {
    x: radius * spread * Math.sin(meridian),
    y:
      -radius *
      (Math.cos(tilt) * Math.sin(parallel) -
        Math.sin(tilt) * spread * Math.cos(meridian)),
    depth:
      Math.sin(tilt) * Math.sin(parallel) +
      Math.cos(tilt) * spread * Math.cos(meridian),
  };
};

const withAlpha = (color: string, alpha: number) =>
  color.replace(/\)\s*$/, ` / ${alpha})`);

const graticule: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  ...Array.from({ length: 12 }, (_, index) =>
    Array.from(
      { length: 46 },
      (_, step) => [index * 30 - 180, step * 4 - 90] as const,
    ),
  ),
  ...[-60, -30, 0, 30, 60].map((latitude) =>
    Array.from(
      { length: 91 },
      (_, step) => [step * 4 - 180, latitude] as const,
    ),
  ),
];

const bezierAt = (
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  progress: number,
) => {
  const rest = 1 - progress;

  return {
    x:
      rest * rest * start.x +
      2 * rest * progress * control.x +
      progress * progress * end.x,
    y:
      rest * rest * start.y +
      2 * rest * progress * control.y +
      progress * progress * end.y,
  };
};

type Scene = {
  size: number;
  view: View;
  destination: Projected;
  flight: number;
  sinceArrival: number;
};

const layoutOf = (size: number) => ({
  center: { x: size * 0.55, y: size * 0.5 },
  radius: size * 0.37,
  sender: { x: size * 0.14, y: size * 0.15 },
});

const flightCurve = (size: number, destination: Projected) => {
  const { center, sender } = layoutOf(size);

  const end = {
    x: center.x + destination.x,
    y: center.y + destination.y - landingLift,
  };

  const middle = { x: (sender.x + end.x) / 2, y: (sender.y + end.y) / 2 };

  return {
    start: sender,
    control: { x: middle.x + size * 0.04, y: middle.y - size * 0.22 },
    end,
  };
};

export function paint(
  context: CanvasRenderingContext2D,
  palette: Palette,
  scene: Scene,
) {
  const { size, view } = scene;
  const { center, radius } = layoutOf(size);

  context.clearRect(0, 0, size, size);

  const atmosphere = context.createRadialGradient(
    center.x,
    center.y,
    radius * 0.9,
    center.x,
    center.y,
    radius * 1.35,
  );

  atmosphere.addColorStop(0, withAlpha(palette.accent, 0.22));
  atmosphere.addColorStop(1, withAlpha(palette.accent, 0));
  context.fillStyle = atmosphere;
  context.fillRect(0, 0, size, size);

  const back = new Path2D();
  const front = new Path2D();
  const limb = new Path2D();

  for (const line of graticule) {
    let previous: Projected | undefined;

    for (const [longitude, latitude] of line) {
      const point = project(view, longitude, latitude, radius);

      if (previous) {
        const depth = (previous.depth + point.depth) / 2;
        const path = depth < 0 ? back : depth > 0.35 ? front : limb;

        path.moveTo(center.x + previous.x, center.y + previous.y);
        path.lineTo(center.x + point.x, center.y + point.y);
      }

      previous = point;
    }
  }

  context.lineWidth = 1;
  context.setLineDash([2, 4]);
  context.strokeStyle = withAlpha(palette.ink, 0.12);
  context.stroke(back);
  context.setLineDash([]);

  context.fillStyle = withAlpha(palette.ink, 0.16);

  const frontDots: Projected[] = [];

  for (let index = 0; index < landDots.length; index += 2) {
    const point = project(
      view,
      landDots[index] ?? 0,
      landDots[index + 1] ?? 0,
      radius,
    );

    if (point.depth < 0)
      context.fillRect(
        center.x + point.x - 0.6,
        center.y + point.y - 0.6,
        1.2,
        1.2,
      );
    else frontDots.push(point);
  }

  const sphere = context.createRadialGradient(
    center.x - radius * 0.35,
    center.y - radius * 0.4,
    radius * 0.1,
    center.x,
    center.y,
    radius,
  );

  sphere.addColorStop(0, withAlpha(palette.surface, 0.55));
  sphere.addColorStop(0.7, withAlpha(palette.surface, 0.8));
  sphere.addColorStop(1, withAlpha(palette.surface, 0.95));
  context.fillStyle = sphere;
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = withAlpha(palette.ink, 0.1);
  context.stroke(limb);
  context.lineWidth = 1.2;
  context.strokeStyle = withAlpha(palette.ink, 0.22);
  context.stroke(front);

  for (const point of frontDots) {
    context.fillStyle = withAlpha(palette.ink, 0.18 + point.depth * 0.5);
    const dot = 1 + point.depth * 0.9;

    context.fillRect(
      center.x + point.x - dot / 2,
      center.y + point.y - dot / 2,
      dot,
      dot,
    );
  }

  context.lineWidth = 1.5;
  context.strokeStyle = withAlpha(palette.accent, 0.45);
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.stroke();

  const curve = flightCurve(size, scene.destination);

  if (scene.flight > 0) {
    const fade = clamp01(1 - scene.sinceArrival / 700);
    const tail = Math.max(0, scene.flight - 0.5);
    const steps = 32;

    context.lineCap = "round";

    for (let step = 0; step < steps; step++) {
      const from = tail + ((scene.flight - tail) * step) / steps;
      const to = tail + ((scene.flight - tail) * (step + 1)) / steps;
      const head = bezierAt(curve.start, curve.control, curve.end, to);
      const foot = bezierAt(curve.start, curve.control, curve.end, from);

      context.strokeStyle = withAlpha(
        palette.accent,
        (0.9 * (step + 1) * fade) / steps,
      );
      context.lineWidth = 2.5;
      context.beginPath();
      context.moveTo(foot.x, foot.y);
      context.lineTo(head.x, head.y);
      context.stroke();
    }
  }

  if (scene.sinceArrival >= 0) {
    const ripple = clamp01(scene.sinceArrival / 950);

    const city = {
      x: center.x + scene.destination.x,
      y: center.y + scene.destination.y,
    };

    context.strokeStyle = withAlpha(palette.accent, 0.7 * (1 - ripple));
    context.lineWidth = 2;
    context.beginPath();
    context.arc(city.x, city.y, 4 + ripple * 22, 0, Math.PI * 2);
    context.stroke();

    context.fillStyle = palette.accent;
    context.beginPath();
    context.arc(city.x, city.y, 3.5, 0, Math.PI * 2);
    context.fill();
  }
}

export type GlobeFrame = {
  turn: number;
  settled: boolean;
  arrived: boolean;
  scene: Scene;
  sender: { x: number; y: number };
  linkPill: { x: number; y: number; opacity: number };
  receiverCity: { x: number; y: number };
};

export function frameAt(
  elapsed: number,
  size: number,
  reduced: boolean,
  receiverTurn: number,
): GlobeFrame {
  const turn = Math.floor(elapsed / cycleMilliseconds);
  const phase = elapsed - turn * cycleMilliseconds;
  const settling = turn === 0 || reduced ? 0 : turnMilliseconds;
  const landing = reduced ? 300 : flightEnd;

  const rotation =
    turn === 0 || reduced
      ? 1
      : easeInOutCubic(clamp01(phase / turnMilliseconds));

  const view = blendViews(
    viewOf(cashOutAt(Math.max(turn - 1, 0))),
    viewOf(cashOutAt(turn)),
    rotation,
  );

  const { radius, center } = layoutOf(size);
  const target = cashOutAt(turn);
  const destination = project(view, target.longitude, target.latitude, radius);

  const flight = reduced
    ? 0
    : easeInOutCubic(
        clamp01((phase - flightStart) / (flightEnd - flightStart)),
      );

  const curve = flightCurve(size, destination);
  const head = bezierAt(curve.start, curve.control, curve.end, flight);
  const receiver = cashOutAt(receiverTurn);

  const receiverPoint = project(
    view,
    receiver.longitude,
    receiver.latitude,
    radius,
  );

  return {
    turn,
    settled: phase >= settling,
    arrived: phase >= landing,
    scene: {
      size,
      view,
      destination,
      flight,
      sinceArrival: phase >= landing ? phase - landing : -1,
    },
    sender: curve.start,
    linkPill: {
      x: head.x,
      y: head.y,
      opacity: flight > 0 && flight < 1 ? Math.min(1, flight * 6) : 0,
    },
    receiverCity: {
      x: center.x + receiverPoint.x,
      y: center.y + receiverPoint.y,
    },
  };
}
