import { CoinsIcon } from "lucide-react";
import type { Asset } from "@workspace/wallet";

function UsdcIcon() {
  return (
    <span className="flex size-6 items-center justify-center rounded-full bg-token-usdc text-label-lg leading-none text-token-usdc-foreground">
      $
    </span>
  );
}

export function TokenIcon({ asset }: { asset: Asset }) {
  return asset.code === "USDC" ? <UsdcIcon /> : <CoinsIcon />;
}
