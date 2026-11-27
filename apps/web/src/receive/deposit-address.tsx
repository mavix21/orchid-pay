import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import type { AccountAddress } from "@workspace/wallet";

import { AddressQr } from "@/components/address-qr";
import { ScreenActions } from "@/components/screen";
import { m } from "@/paraglide/messages";

export function DepositAddress({ address }: { address: AccountAddress }) {
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string>();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setProblem(undefined);
      setCopied(true);
    } catch {
      setProblem(m.deposit_copy_failed());
    }
  };

  return (
    <>
      <main className="flex flex-1 flex-col items-center gap-6 px-5 pt-2">
        <div className="w-full max-w-64">
          <AddressQr value={address} label={m.deposit_qr_label()} />
        </div>
        <div className="flex w-full flex-col gap-2">
          <p className="text-label text-muted-foreground">
            {m.deposit_address_title()}
          </p>
          <p
            className="font-mono text-body break-all select-all"
            data-testid="deposit-address"
            data-address={address}
          >
            {address}
          </p>
        </div>
        <p className="text-body text-pretty text-muted-foreground">
          {m.deposit_usdc_only()}
        </p>
        {problem === undefined ? null : (
          <p role="alert" className="text-body text-destructive">
            {problem}
          </p>
        )}
      </main>
      <ScreenActions>
        <Button className="w-full" onClick={copy} data-testid="copy-address">
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? m.activity_address_copied() : m.activity_copy_address()}
        </Button>
      </ScreenActions>
    </>
  );
}
