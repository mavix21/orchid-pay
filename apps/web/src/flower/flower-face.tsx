import type { Eye, Flower, Mouth } from "@/flower/flower";

const ink = "var(--flower-ink)";

const blush = "var(--flower-blush)";

const shine = "var(--flower-shine)";

function Line({ d }: { d: string }) {
  return (
    <path
      d={d}
      fill="none"
      stroke={ink}
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

const openMouth = "M-3.6 -1.2 Q0 6 3.6 -1.2Z";

const eyes: Record<Eye, React.ReactNode> = {
  dot: <circle r={2.7} fill={ink} />,
  happy: <Line d="M-3.2 1.6 Q0 -3.2 3.2 1.6" />,
  sleepy: <Line d="M-3.2 -1.2 Q0 3 3.2 -1.2" />,
  squintLeft: <Line d="M-2.4 -3 L2.4 0 L-2.4 3" />,
  squintRight: <Line d="M2.4 -3 L-2.4 0 L2.4 3" />,
  v: <Line d="M-3 -1.4 L0 1.6 L3 -1.4" />,
  sparkle: (
    <>
      <circle r={4.2} fill={shine} />
      <circle cx={0.7} cy={0.7} r={2.6} fill={ink} />
      <circle cx={-0.6} cy={-0.8} r={0.9} fill={shine} />
    </>
  ),
};

const mouths: Record<Mouth, React.ReactNode> = {
  smile: <Line d="M-4 -1 Q0 4 4 -1" />,
  o: <circle r={2.1} fill={ink} />,
  open: <path d={openMouth} fill={ink} />,
  cat: <Line d="M-4.6 -1 Q-2.3 2.8 0 -0.6 Q2.3 2.8 4.6 -1" />,
  tongue: (
    <>
      <path d={openMouth} fill={ink} />
      <ellipse cy={2.4} rx={1.7} ry={1.1} fill={blush} />
    </>
  ),
  tiny: <Line d="M-2.2 0 Q0 2.2 2.2 0" />,
  tooth: (
    <>
      <path d={openMouth} fill={ink} />
      <rect x={-1.3} y={-1.2} width={2.6} height={1.8} rx={0.4} fill={shine} />
    </>
  ),
};

const faceScale = 1.35;

export function FlowerFace({ flower }: { flower: Flower }) {
  const [left, right] = flower.eyes;

  return (
    <g transform={`rotate(${flower.tilt.toFixed(1)}) scale(${faceScale})`}>
      {flower.blush ? (
        <>
          <ellipse
            cx={-12.5}
            cy={4}
            rx={3.4}
            ry={2.2}
            fill={blush}
            opacity={0.6}
          />
          <ellipse
            cx={12.5}
            cy={4}
            rx={3.4}
            ry={2.2}
            fill={blush}
            opacity={0.6}
          />
        </>
      ) : null}
      <g transform="translate(-8 -2)">{eyes[left]}</g>
      <g transform="translate(8 -2)">{eyes[right]}</g>
      <g transform="translate(0 7)">{mouths[flower.mouth]}</g>
    </g>
  );
}
