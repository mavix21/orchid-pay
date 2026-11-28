import { Button } from "@workspace/ui/components/button";
import type { PaymentRequestOpen } from "@workspace/wallet";

import { AddressQr } from "@/components/address-qr";
import { amountLabel } from "@/send/money";
import { m } from "@/paraglide/messages";

export function ExternalPay({ request }: { request: PaymentRequestOpen }) {
  const amount = amountLabel(request.amount, request.asset);

  const transactionRequest = `solana:${new URL(`/api/actions/pay/${request.id}`, window.location.origin).href}`;

  return (
    <section
      className="flex flex-col items-center gap-3 px-5 pb-6 text-center"
      data-testid="external-pay"
      data-link={transactionRequest}
    >
      <h2 className="text-label-lg">{m.pay_request_external_title()}</h2>
      <div className="w-full max-w-48">
        <AddressQr
          value={transactionRequest}
          label={m.pay_request_external_qr_label({ amount })}
        />
      </div>
      <p className="text-body text-pretty text-muted-foreground">
        {m.pay_request_external_note({ amount })}
      </p>
      <Button
        variant="secondary"
        size="sm"
        nativeButton={false}
        render={<a href={transactionRequest} />}
      >
        {m.pay_request_external_open()}
      </Button>
    </section>
  );
}
