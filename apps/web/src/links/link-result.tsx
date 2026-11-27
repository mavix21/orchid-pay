import { Button } from "@workspace/ui/components/button";

import { ScreenActions, ScreenNote, ScreenStatus } from "@/components/screen";

export function LinkWorking({ label, note }: { label: string; note?: string }) {
  return (
    <ScreenStatus title={label}>
      {note === undefined ? null : <ScreenNote>{note}</ScreenNote>}
    </ScreenStatus>
  );
}

export function LinkResultScreen({
  outcome,
  screen,
  children,
}: {
  outcome: string;
  screen: { readonly title: string; readonly message: string };
  children: React.ReactNode;
}) {
  return (
    <>
      <ScreenStatus
        title={screen.title}
        data-testid="link-outcome"
        data-outcome={outcome}
      >
        <ScreenNote>{screen.message}</ScreenNote>
      </ScreenStatus>
      <ScreenActions>{children}</ScreenActions>
    </>
  );
}

export function ResultButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      className="w-full"
      onClick={onClick}
      data-testid="link-result-action"
    >
      {children}
    </Button>
  );
}

export function ResultLink({
  link,
  variant = "default",
  children,
}: {
  link: React.ReactElement;
  variant?: "default" | "secondary";
  children: React.ReactNode;
}) {
  return (
    <Button
      className="w-full"
      variant={variant}
      nativeButton={false}
      render={link}
      data-testid="link-result-action"
    >
      {children}
    </Button>
  );
}
