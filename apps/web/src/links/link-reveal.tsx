import { CheckIcon, CopyIcon, ShareIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@workspace/ui/components/button";
import type { PaymentLinkRevealed, SavedLinkTarget } from "@workspace/wallet";
import * as Data from "effect/Data";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/components/modal";
import { amountLabel } from "@/send/money";
import { useWalletTask } from "@/send/use-wallet-task";
import { walletEffects } from "@/wallet";
import { m } from "@/paraglide/messages";

import { type Delivery, delivered, nextDelivery } from "./link-step";
import { type RevealRefusal, revealResult } from "./outcomes";
import { pageHidden, usePageDeparture } from "./page-departure";
import {
  type ShareResult,
  type ShareableLink,
  copyLink,
  nativeShareAvailable,
  shareLink,
} from "./share-link";

type Reveal = Data.TaggedEnum<{
  Closed: {};
  Opening: { readonly target: SavedLinkTarget };
  Opened: {
    readonly link: PaymentLinkRevealed;
    readonly delivery: Delivery;
    readonly delivering: boolean;
  };
  Refused: {
    readonly target: SavedLinkTarget;
    readonly outcome: RevealRefusal;
  };
}>;

const Reveal = Data.taggedEnum<Reveal>();

const withoutCode = (reveal: Reveal, unloading: boolean): Reveal =>
  Predicate.isTagged(reveal, "Opened") && (unloading || !reveal.delivering)
    ? Reveal.Closed()
    : reveal;

const deliveryNote = (delivery: Delivery) =>
  Match.value(delivery).pipe(
    Match.when("none", () => Option.none<string>()),
    Match.when("shared", () => Option.some(m.link_delivery_shared())),
    Match.when("copied", () => Option.some(m.link_delivery_copied())),
    Match.when("dismissed", () => Option.some(m.link_delivery_dismissed())),
    Match.when("failed", () => Option.some(m.link_delivery_failed())),
    Match.exhaustive,
  );

export function DeliveryNote({ delivery }: { delivery: Delivery }) {
  return (
    <p
      role="status"
      className="flex min-h-6 items-center justify-center gap-2 text-label text-accent-foreground"
    >
      {delivered(delivery) ? <CheckIcon className="size-5 shrink-0" /> : null}
      {Option.getOrUndefined(deliveryNote(delivery))}
    </p>
  );
}

export function DeliveryActions({
  delivering,
  onShare,
  onCopy,
}: {
  delivering: boolean;
  onShare: () => void;
  onCopy: () => void;
}) {
  return (
    <>
      {nativeShareAvailable() ? (
        <Button
          className="w-full"
          onClick={onShare}
          disabled={delivering}
          data-testid="share-link"
        >
          <ShareIcon />
          {m.link_share()}
        </Button>
      ) : null}
      <Button
        className="w-full"
        variant={nativeShareAvailable() ? "secondary" : "default"}
        onClick={onCopy}
        disabled={delivering}
        data-testid="copy-link"
      >
        <CopyIcon />
        {m.link_copy()}
      </Button>
    </>
  );
}

export function useLinkReveal() {
  const task = useWalletTask();
  const [reveal, setReveal] = useState<Reveal>(Reveal.Closed());

  usePageDeparture(
    () => setReveal((current) => withoutCode(current, false)),
    () => setReveal((current) => withoutCode(current, true)),
  );

  const open = (target: SavedLinkTarget) => {
    setReveal(Reveal.Opening({ target }));
    task.run(walletEffects.revealPaymentLink(target), (answer) =>
      setReveal(
        Predicate.isTagged(answer, "PaymentLinkRevealed")
          ? Reveal.Opened({ link: answer, delivery: "none", delivering: false })
          : Reveal.Refused({ target, outcome: answer }),
      ),
    );
  };

  const deliver = (send: (link: ShareableLink) => Promise<ShareResult>) => {
    if (!Predicate.isTagged(reveal, "Opened")) return;

    const { link } = reveal;

    setReveal(Reveal.Opened({ ...reveal, delivering: true }));
    void send(link).then((result) => {
      const hidden = pageHidden();

      setReveal((current) =>
        Predicate.isTagged(current, "Opened") && current.link === link
          ? hidden
            ? Reveal.Closed()
            : Reveal.Opened({
                link,
                delivery: nextDelivery(current.delivery, result),
                delivering: false,
              })
          : current,
      );
    });
  };

  const close = () => {
    task.stop();
    setReveal(Reveal.Closed());
  };

  return {
    reveal,
    open,
    share: () => deliver(shareLink),
    copy: () => deliver(copyLink),
    close,
  };
}

export function LinkShareModal({
  sharing,
  onRecover,
}: {
  sharing: ReturnType<typeof useLinkReveal>;
  onRecover: (target: SavedLinkTarget) => void;
}) {
  const { reveal, open, share, copy, close } = sharing;

  return (
    <Modal
      open={!Predicate.isTagged(reveal, "Closed")}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <ModalContent testId="link-share-drawer">
        {Match.valueTags(reveal, {
          Closed: () => null,
          Opening: () => (
            <ModalHeader>
              <ModalTitle>{m.link_opening()}</ModalTitle>
              <ModalDescription>{m.link_opening_note()}</ModalDescription>
            </ModalHeader>
          ),
          Opened: ({ link, delivery, delivering }) => (
            <>
              <ModalHeader>
                <ModalTitle>{m.link_share_title()}</ModalTitle>
                <ModalDescription>
                  {m.link_share_description({
                    amount: amountLabel(link.amount, link.asset),
                  })}
                </ModalDescription>
              </ModalHeader>
              <DeliveryNote delivery={delivery} />
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
          Refused: ({ target, outcome }) => {
            const screen = revealResult(outcome);

            return (
              <>
                <ModalHeader>
                  <ModalTitle>{screen.title}</ModalTitle>
                  <ModalDescription
                    testId="reveal-outcome"
                    outcome={outcome._tag}
                  >
                    {screen.message}
                  </ModalDescription>
                </ModalHeader>
                <ModalFooter>
                  {screen.action === "retry" ? (
                    <Button className="w-full" onClick={() => open(target)}>
                      {m.common_retry()}
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={() => {
                        close();
                        onRecover(target);
                      }}
                    >
                      {m.link_recover_amount({
                        amount: amountLabel(target.amount, target.asset),
                      })}
                    </Button>
                  )}
                  <Button className="w-full" variant="ghost" onClick={close}>
                    {m.common_close()}
                  </Button>
                </ModalFooter>
              </>
            );
          },
        })}
      </ModalContent>
    </Modal>
  );
}
