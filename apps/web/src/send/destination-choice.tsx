import { LinkIcon, UserRoundIcon, WalletIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";

import { OptionRow } from "@/components/option-row";
import { ScreenActions, ScreenNote, ScreenStatus } from "@/components/screen";

import type { Destination, FieldProblem } from "./intent";

import { m } from "@/paraglide/messages";

export type Choice = Destination | "link";

export function LinkOffer({
  problem,
  amount,
  onAccept,
  onDecline,
}: {
  problem: FieldProblem;
  amount: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <>
      <ScreenStatus title={problem.message} data-testid="link-offer">
        <ScreenNote>{m.send_link_offer_note({ amount })}</ScreenNote>
      </ScreenStatus>
      <ScreenActions>
        <Button className="w-full" onClick={onAccept} data-testid="offer-link">
          {m.send_link_offer_accept()}
        </Button>
        <Button
          className="w-full"
          variant="secondary"
          onClick={onDecline}
          data-testid="decline-link"
        >
          {m.send_change_recipient()}
        </Button>
      </ScreenActions>
    </>
  );
}

export function DestinationChoice({
  onChoose,
}: {
  onChoose: (choice: Choice) => void;
}) {
  return (
    <>
      <main className="flex flex-1 flex-col gap-6 px-5 pt-2">
        <h1 className="font-display text-h1">{m.send_destination_title()}</h1>
        <div className="flex flex-col gap-3">
          <OptionRow
            title={m.send_destination_username()}
            description={m.send_destination_username_note()}
            media={<UserRoundIcon />}
            render={
              <button
                type="button"
                onClick={() => onChoose("username")}
                data-testid="choose-username"
              />
            }
          />
          <OptionRow
            title={m.send_destination_address()}
            description={m.send_destination_address_note()}
            media={<WalletIcon />}
            render={
              <button
                type="button"
                onClick={() => onChoose("address")}
                data-testid="choose-address"
              />
            }
          />
          <OptionRow
            title={m.send_destination_link()}
            description={m.send_destination_link_note()}
            media={<LinkIcon />}
            render={
              <button
                type="button"
                onClick={() => onChoose("link")}
                data-testid="choose-link"
              />
            }
          />
        </div>
      </main>
      <ScreenActions>
        <Button
          className="w-full"
          variant="secondary"
          nativeButton={false}
          render={<Link to="/links" data-testid="open-links" />}
        >
          {m.send_view_links()}
        </Button>
      </ScreenActions>
    </>
  );
}
