import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@workspace/ui/lib/utils";

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-transparent bg-clip-padding whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:text-disabled-foreground aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary-pressed active:bg-primary-pressed disabled:bg-primary-disabled",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-pressed active:bg-pressed aria-expanded:bg-pressed",
        ghost:
          "text-foreground hover:bg-secondary active:bg-pressed aria-expanded:bg-secondary",
        destructive:
          "text-destructive hover:bg-danger active:bg-danger focus-visible:ring-destructive/20",
      },
      size: {
        default: "h-14 px-6 text-label-lg",
        sm: "h-11 px-5 text-label",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
