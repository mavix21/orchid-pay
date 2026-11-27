import * as React from "react";
import { cn } from "@workspace/ui/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-md border-2 border-transparent bg-secondary px-4 py-3 text-body-lg text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-card disabled:cursor-not-allowed disabled:text-disabled-foreground aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
