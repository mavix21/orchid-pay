import { Badge } from "@workspace/ui/components/badge";

export function NetworkBadge({ network }: { network: string }) {
  return network === "devnet" ? <Badge variant="neutral">Devnet</Badge> : null;
}
