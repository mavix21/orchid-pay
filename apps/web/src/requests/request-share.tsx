import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@workspace/ui/components/button";
import type { PaymentRequestOpen } from "@workspace/wallet";
import * as Match from "effect/Match";
import * as Option from "effect/Option";

import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/components/modal";
import { DeliveryActions } from "@/links/link-reveal";
import { type Delivery, delivered, nextDelivery } from "@/links/link-step";
import {
  type ShareResult,
  type ShareableLink,
  copyPaymentRequestLink,
  sharePaymentRequest,
} from "@/links/share-link";
import { amountLabel } from "@/send/money";
import { m } from "@/paraglide/messages";

interface SharedRequest {
  readonly request: PaymentRequestOpen;
  readonly delivery: Delivery;
  readonly delivering: boolean;
}

const deliveryNote = (delivery: Delivery) =>
  Match.value(delivery).pipe(
    Match.when("none", () => Option.none<string>()),
    Match.when("shared", () => Option.some(m.payment_request_shared())),
    Match.when("copied", () => Option.some(m.payment_request_copied())),
    Match.when("dismissed", () =>
      Option.some(m.payment_request_share_dismissed()),
    ),
    Match.when("failed", () => Option.some(m.payment_request_share_failed())),
    Match.exhaustive,
  );

export function useRequestShare() {
  const [shared, setShared] = useState(Option.none<SharedRequest>());

  const open = (request: PaymentRequestOpen) =>
    setShared(Option.some({ request, delivery: "none", delivering: false }));

  const deliver = (send: (link: ShareableLink) => Promise<ShareResult>) => {
    if (Option.isNone(shared)) return;

    const { request } = shared.value;

    setShared(Option.some({ ...shared.value, delivering: true }));
    void send({
      path: `/pay/${request.id}`,
      asset: request.asset,
      amount: request.amount,
    }).then((result) =>
      setShared(
        Option.map((current) =>
          current.request === request
            ? {
                request,
                delivery: nextDelivery(current.delivery, result),
                delivering: false,
              }
            : current,
        ),
      ),
    );
  };

  return {
    shared,
    open,
    share: () => deliver(sharePaymentRequest),
    copy: () => deliver(copyPaymentRequestLink),
    close: () => setShared(Option.none()),
  };
}

export function RequestShareModal({
  sharing,
}: {
  sharing: ReturnType<typeof useRequestShare>;
}) {
  const { shared, share, copy, close } = sharing;

  return (
    <Modal
      open={Option.isSome(shared)}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <ModalContent testId="request-share">
        {Option.match(shared, {
          onNone: () => null,
          onSome: ({ request, delivery, delivering }) => (
            <>
              <ModalHeader>
                <ModalTitle>{m.payment_request_share_modal_title()}</ModalTitle>
                <ModalDescription>
                  {m.payment_request_share_modal_description({
                    amount: amountLabel(request.amount, request.asset),
                  })}
                </ModalDescription>
              </ModalHeader>
              <p
                role="status"
                className="flex min-h-6 items-center justify-center gap-2 text-label text-accent-foreground"
              >
                {delivered(delivery) ? (
                  <CheckIcon className="size-5 shrink-0" />
                ) : null}
                {Option.getOrUndefined(deliveryNote(delivery))}
              </p>
              <ModalFooter>
                <DeliveryActions
                  delivering={delivering}
                  onShare={share}
                  onCopy={copy}
                />
                <Button className="w-full" variant="ghost" onClick={close}>
                  {m.common_close()}
                </Button>
              </ModalFooter>
            </>
          ),
        })}
      </ModalContent>
    </Modal>
  );
}
