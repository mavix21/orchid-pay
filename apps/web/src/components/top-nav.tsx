import { Button } from "@workspace/ui/components/button";

export type TopNavAction =
  | { readonly link: React.ReactElement }
  | { readonly onClick: () => void };

export function TopNav({
  title,
  label,
  icon,
  disabled = false,
  ...action
}: {
  title: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
} & TopNavAction) {
  return (
    <header className="flex h-14 items-center gap-2 px-5">
      {"link" in action ? (
        <Button
          variant="secondary"
          size="icon"
          data-testid="top-nav-action"
          aria-label={label}
          nativeButton={false}
          disabled={disabled}
          render={action.link}
        >
          {icon}
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="icon"
          data-testid="top-nav-action"
          aria-label={label}
          disabled={disabled}
          onClick={action.onClick}
        >
          {icon}
        </Button>
      )}
      <p className="flex-1 text-center text-label-lg">{title}</p>
      <div className="size-10" />
    </header>
  );
}
