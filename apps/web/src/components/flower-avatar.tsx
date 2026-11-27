import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar";

import { type Shade, type Swirl, flowerOf } from "@/flower/flower";
import { FlowerFace } from "@/flower/flower-face";
import { petalLength, petalPath, sealedWidth } from "@/flower/petal";

const sealedDepth = { deep: 0.58, soft: 0.74 };

const swirlDegrees: Record<Swirl, number> = {
  left: -15,
  straight: 0,
  right: 15,
};

const shaded = (petal: string): Record<Shade, string> => ({
  mid: petal,
  light: `color-mix(in oklch, ${petal}, white 24%)`,
  deep: `color-mix(in oklch, ${petal}, black 9%)`,
});

const centerRadius = petalLength / 2;

export function FlowerAvatar({
  username,
  size,
}: {
  username: string;
  size?: React.ComponentProps<typeof Avatar>["size"];
}) {
  const flower = flowerOf(username);

  const hue = flower.hue.toFixed(1);

  const fill = shaded(
    `oklch(var(--flower-petal-lightness) var(--flower-petal-chroma) ${hue})`,
  )[flower.shade];

  const width =
    sealedWidth(flower.tip, flower.petals, sealedDepth[flower.lobes]) *
    flower.fullness;

  const outline = petalPath(flower.tip, width);

  const angles = Array.from(
    { length: flower.petals },
    (_, index) => flower.rotation + (360 / flower.petals) * index,
  );

  return (
    <Avatar size={size}>
      <AvatarFallback>
        <svg viewBox="-50 -50 100 100" aria-hidden="true" className="size-full">
          <rect
            x={-50}
            y={-50}
            width={100}
            height={100}
            fill={`oklch(var(--flower-backdrop-lightness) var(--flower-backdrop-chroma) ${hue})`}
          />
          <g transform="scale(0.9)">
            {angles.map((angle) => (
              <path
                key={angle}
                d={outline}
                fill={fill}
                transform={`rotate(${angle.toFixed(2)}) skewX(${swirlDegrees[flower.swirl]})`}
              />
            ))}
            <circle r={centerRadius} fill={fill} />
            <FlowerFace flower={flower} />
          </g>
        </svg>
      </AvatarFallback>
    </Avatar>
  );
}
