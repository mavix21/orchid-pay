import { createContext, useContext } from "react";

import { BrandLogo } from "@/components/brand-logo";

type ScreenPlacement = "focused" | "shell";

const ScreenPlacementContext = createContext<ScreenPlacement>("focused");

export function ShellScreens({ children }: { children: React.ReactNode }) {
  return (
    <ScreenPlacementContext value="shell">{children}</ScreenPlacementContext>
  );
}

export function Screen({ children }: { children: React.ReactNode }) {
  const placement = useContext(ScreenPlacementContext);

  if (placement === "shell")
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background pt-safe text-foreground md:min-h-0 md:max-w-xl md:flex-1 md:bg-transparent md:pt-14">
        {children}
      </div>
    );

  return (
    <div className="flex min-h-dvh w-full flex-col bg-background text-foreground md:bg-canvas md:px-6 md:pb-20">
      <div className="hidden h-20 shrink-0 items-center md:flex">
        <BrandLogo />
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col pt-safe md:my-auto md:min-h-136 md:max-w-lg md:flex-none md:rounded-xl md:bg-background md:pb-4 md:shadow-surface md:ring-1 md:ring-foreground/5">
        {children}
      </div>
    </div>
  );
}

export function ScreenActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-5 pt-4 pb-safe">
      {children}
    </div>
  );
}

export function ScreenStatus({
  title,
  media,
  children,
  ...props
}: {
  title: React.ReactNode;
  media?: React.ReactNode;
  children?: React.ReactNode;
} & Omit<React.ComponentProps<"main">, "className" | "role" | "title">) {
  return (
    <main
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-8 text-center"
      {...props}
    >
      {media}
      <div className="flex flex-col items-center gap-2">
        <h1 className="font-display text-h1 text-balance">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function ScreenNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-body text-pretty text-muted-foreground">{children}</p>
  );
}
