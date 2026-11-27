import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@workspace/ui/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-14 w-full min-w-0 rounded-md border-2 border-transparent bg-secondary px-4 text-body-lg text-foreground transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-label file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-card disabled:pointer-events-none disabled:cursor-not-allowed disabled:text-disabled-foreground aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
