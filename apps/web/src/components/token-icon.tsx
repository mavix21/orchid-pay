import { CoinsIcon } from "lucide-react";
import { type Asset, isNativeAsset } from "@workspace/wallet";

function UsdcIcon() {
  return (
    <span className="flex size-6 items-center justify-center rounded-full bg-token-usdc text-label-lg leading-none text-token-usdc-foreground">
      $
    </span>
  );
}

function LumenIcon() {
  return (
    <span className="flex size-6 rounded-full bg-inverse text-inverse-foreground">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M17.625 12C17.625 15.1066 15.1066 17.625 12 17.625C8.8934 17.625 6.375 15.1066 6.375 12C6.375 8.8934 8.8934 6.375 12 6.375C15.1066 6.375 17.625 8.8934 17.625 12Z"
          strokeWidth="1.8"
          stroke="currentColor"
        />
        <path
          d="M5.25 14.625L18.75 9"
          strokeWidth="1.8"
          strokeLinecap="round"
          stroke="currentColor"
        />
      </svg>
    </span>
  );
}

export function TokenIcon({ asset }: { asset: Asset }) {
  if (isNativeAsset(asset)) return <LumenIcon />;

  return asset.code === "USDC" ? <UsdcIcon /> : <CoinsIcon />;
}
