import { Badge } from "@workspace/ui/components/badge";

export function ReviewHero({
  title,
  amount,
  network,
}: {
  title: string;
  amount: string;
  network: string;
}) {
  return (
    <header className="flex flex-col items-center gap-2 pt-6 text-center">
      <h1 className="text-body text-muted-foreground">{title}</h1>
      <p className="font-display text-display">{amount}</p>
      {network === "testnet" ? <Badge variant="neutral">Testnet</Badge> : null}
    </header>
  );
}
