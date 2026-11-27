import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@workspace/ui/lib/utils";

const skeletonVariants = cva("animate-pulse bg-muted", {
  variants: {
    variant: {
      text: "rounded-md",
      avatar: "rounded-full",
      tile: "rounded-lg",
    },
  },
  defaultVariants: {
    variant: "text",
  },
});

let sharedPulseStart: CSSNumberish | null = null;

function keepSharedPulse(element: HTMLDivElement | null) {
  for (const animation of element?.getAnimations() ?? []) {
    sharedPulseStart ??= animation.startTime ?? document.timeline.currentTime;
    animation.startTime = sharedPulseStart;
  }
}

function Skeleton({
  className,
  variant = "text",
  ref,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof skeletonVariants>) {
  return useRender({
    defaultTagName: "div",
    ref: [ref ?? null, keepSharedPulse],
    props: mergeProps<"div">(
      {
        className: cn(skeletonVariants({ variant }), className),
      },
      props,
    ),
    state: {
      slot: "skeleton",
      variant,
    },
  });
}

export { Skeleton };
