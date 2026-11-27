import { cn } from "@workspace/ui/lib/utils";

import { ScreenActions } from "@/components/screen";

type OrchidMotion = "bloom" | "flourish" | "rest" | "breathe" | "sway";

type PartStyle = React.CSSProperties & {
  "--angle": string;
  "--stagger": string;
  "--bud-x": string;
  "--bud-y": string;
};

type HeroStyle = React.CSSProperties & {
  "--glow-delay": string;
  "--reveal-delay": string;
};

interface FlowerPart {
  readonly kind: "sepal" | "petal";
  readonly angle: number;
  readonly stagger: number;
  readonly budX: number;
  readonly budY: number;
}

const sepalPath = "M100 96C85 84 80 44 100 20C120 44 115 84 100 96Z";

const petalPath =
  "M100 96C84 92 56 72 58 44C60 22 82 14 100 14C118 14 140 22 142 44C144 72 116 92 100 96Z";

const petalVeins =
  "M100 90V30M100 88C92 74 84 56 80 36M100 88C108 74 116 56 120 36";

const parts: ReadonlyArray<FlowerPart> = [
  { kind: "sepal", angle: -148, stagger: 0.05, budX: 0.8, budY: 0.78 },
  { kind: "sepal", angle: 148, stagger: 0.05, budX: 0.8, budY: 0.78 },
  { kind: "sepal", angle: 0, stagger: 0, budX: 0.8, budY: 0.78 },
  { kind: "petal", angle: -70, stagger: 0.1, budX: 0.24, budY: 0.48 },
  { kind: "petal", angle: 70, stagger: 0.1, budX: 0.24, budY: 0.48 },
];

const partMotion: Record<OrchidMotion, string> = {
  bloom: "orchid-part orchid-unfold",
  flourish: "orchid-part orchid-flourish",
  rest: "orchid-part",
  breathe: "orchid-part",
  sway: "orchid-part orchid-sway",
};

export function OrchidBloom({
  motion,
  className,
}: {
  motion: OrchidMotion;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden="true"
      className={cn(
        motion === "breathe" && "orchid-breathe",
        motion === "bloom" && "orchid-land",
        className,
      )}
    >
      {parts.map(({ kind, angle, stagger, budX, budY }) => {
        const style: PartStyle = {
          "--angle": `${angle}deg`,
          "--stagger": `${stagger}s`,
          "--bud-x": `${budX}`,
          "--bud-y": `${budY}`,
        };

        return kind === "sepal" ? (
          <path
            key={angle}
            className={cn("orchid-sepal", partMotion[motion])}
            style={style}
            d={sepalPath}
          />
        ) : (
          <g key={angle} className={partMotion[motion]} style={style}>
            <path className="fill-primary" d={petalPath} />
            <path
              className="fill-none stroke-primary-pressed opacity-40"
              strokeWidth={1.5}
              strokeLinecap="round"
              d={petalVeins}
            />
          </g>
        );
      })}
      <g className={cn("orchid-lip", motion === "bloom" && "orchid-lip-open")}>
        <path
          className="fill-primary-pressed"
          d="M98 100C86 92 70 98 74 112C77 122 90 120 96 112Z"
        />
        <path
          className="fill-primary-pressed"
          d="M102 100C114 92 130 98 126 112C123 122 110 120 104 112Z"
        />
        <path
          className="fill-primary-pressed"
          d="M100 104C88 104 84 118 91 130C94 135 91 143 84 150C93 150 98 145 100 138C102 145 107 150 116 150C109 143 106 135 109 130C116 118 112 104 100 104Z"
        />
        <path
          className="fill-primary-foreground opacity-90"
          d="M100 84C96 84 94 89 95 95C96 100 98 102 100 102C102 102 104 100 105 95C106 89 104 84 100 84Z"
        />
      </g>
    </svg>
  );
}

export function BloomHero({
  motion,
  label,
  amount,
  children,
}: {
  motion: OrchidMotion;
  label: string;
  amount?: string;
  children?: React.ReactNode;
}) {
  const celebrates = motion === "bloom" || motion === "flourish";

  const style: HeroStyle = {
    "--glow-delay": motion === "bloom" ? "1.15s" : "0.05s",
    "--reveal-delay": motion === "bloom" ? "1.3s" : "0.25s",
  };

  return (
    <section
      className="flex flex-1 flex-col items-center justify-center text-center"
      style={style}
    >
      <div className="flex w-full flex-col items-center gap-6">
        <div className={cn("relative", motion === "bloom" && "orchid-fall")}>
          <div
            aria-hidden="true"
            className={cn(
              "orchid-glow absolute -inset-1/4 rounded-full",
              celebrates && "orchid-glow-in",
            )}
          />
          <OrchidBloom motion={motion} className="relative size-56" />
        </div>
        <div
          className={cn(
            "relative flex w-full flex-col items-center gap-1",
            celebrates && "orchid-reveal",
          )}
        >
          {amount === undefined ? (
            <h1 className="font-display text-h2 text-balance">{label}</h1>
          ) : (
            <>
              <p className="text-label text-muted-foreground">{label}</p>
              <p className="font-display text-display">{amount}</p>
            </>
          )}
          {children === undefined ? null : (
            <div className="absolute inset-x-0 top-full flex flex-col items-center gap-2 pt-2">
              {children}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function BloomActions({ children }: { children?: React.ReactNode }) {
  return (
    <ScreenActions>
      <div className="flex min-h-30 w-full flex-col justify-end gap-2">
        {children}
      </div>
    </ScreenActions>
  );
}
