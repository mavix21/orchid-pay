import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  NewPaymentRequest,
  PaymentRequestNote,
  baseAsset,
  newPaymentRequestId,
  parseAmount,
  paymentRequestNoteMaxLength,
  precisionOf,
} from "@workspace/wallet";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ScreenActions } from "@/components/screen";
import { AmountPad } from "@/send/amount-pad";
import { useWalletTask } from "@/send/use-wallet-task";
import { paymentRequestEffects } from "@/wallet/payment-requests";
import { m } from "@/paraglide/messages";

import { requestRefusal } from "./request-refusal";
import { RequestShareModal, useRequestShare } from "./request-share";

const noteOf = (typed: string) => {
  const note = typed.trim();

  return note === ""
    ? Option.some(undefined)
    : Schema.decodeOption(PaymentRequestNote)(note);
};

export function RequestForm() {
  const task = useWalletTask();
  const sharing = useRequestShare();
  const amountField = useRef<HTMLInputElement>(null);

  const [entry, setEntry] = useState(() => ({
    id: newPaymentRequestId(),
    amount: "",
    note: "",
  }));

  const [creating, setCreating] = useState(false);
  const [noteProblem, setNoteProblem] = useState(Option.none<string>());
  const [problem, setProblem] = useState(Option.none<string>());
  const parsed = parseAmount(entry.amount, precisionOf(baseAsset));

  const edit = (change: { amount: string } | { note: string }) => {
    const next = { ...entry, ...change };

    if (creating || (next.amount === entry.amount && next.note === entry.note))
      return;

    setNoteProblem(Option.none());
    setProblem(Option.none());
    setEntry({ ...next, id: newPaymentRequestId() });
  };

  const conclude = (message: string) => {
    setProblem(Option.some(message));
    setEntry((current) => ({ ...current, id: newPaymentRequestId() }));
  };

  const refuse = (message: string) => setProblem(Option.some(message));

  const create = (request: NewPaymentRequest) => {
    setCreating(true);
    setProblem(Option.none());
    task.run(paymentRequestEffects.create(request), (answer) => {
      setCreating(false);
      Match.valueTags(answer, {
        PaymentRequestOpen: sharing.open,
        PaymentRequestPaid: () => conclude(m.payment_request_already_paid()),
        PaymentRequestCancelled: () =>
          conclude(m.payment_request_already_cancelled()),
        PaymentRequestAssetUnsupported: () =>
          refuse(m.payment_request_asset_unsupported()),
        PaymentRequestLimitReached: ({ limit }) =>
          refuse(m.payment_request_limit_reached({ limit })),
        NeedsReopening: () => refuse(m.payment_request_needs_reopening()),
        NotOpened: (refusal) => refuse(requestRefusal(refusal)),
        NoWallet: (refusal) => refuse(requestRefusal(refusal)),
        UnsupportedDevice: (refusal) => refuse(requestRefusal(refusal)),
        DeviceFailure: (refusal) => refuse(requestRefusal(refusal)),
        Offline: (refusal) => refuse(requestRefusal(refusal)),
        ServerUnreachable: (refusal) => refuse(requestRefusal(refusal)),
        LedgerUnreachable: (refusal) => refuse(requestRefusal(refusal)),
        ServiceFailed: (refusal) => refuse(requestRefusal(refusal)),
        SessionRequired: (refusal) => refuse(requestRefusal(refusal)),
        RateLimited: (refusal) => refuse(requestRefusal(refusal)),
        InvalidResponse: (refusal) => refuse(requestRefusal(refusal)),
      });
    });
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (Option.isNone(parsed)) return;

    const note = noteOf(entry.note);

    if (Option.isNone(note)) {
      setNoteProblem(
        Option.some(
          m.payment_request_note_invalid({ max: paymentRequestNoteMaxLength }),
        ),
      );

      return;
    }

    create(
      new NewPaymentRequest({
        id: entry.id,
        asset: baseAsset,
        amount: parsed.value,
        note: note.value,
      }),
    );
  };

  return (
    <>
      <form className="flex flex-1 flex-col" noValidate onSubmit={submit}>
        <main className="flex flex-1 flex-col gap-4 px-5 pt-2">
          <AmountPad
            amount={entry.amount}
            problem={Option.none()}
            asset={baseAsset}
            field={amountField}
            onAmount={(amount) => edit({ amount })}
          />
          <Field>
            <FieldLabel htmlFor="request-note">
              {m.payment_request_note_label()}
            </FieldLabel>
            <Input
              id="request-note"
              name="note"
              data-testid="request-note"
              value={entry.note}
              maxLength={paymentRequestNoteMaxLength}
              autoComplete="off"
              disabled={creating}
              onChange={(event) => edit({ note: event.target.value })}
              aria-invalid={Option.isSome(noteProblem) ? true : undefined}
              aria-describedby={
                Option.isSome(noteProblem) ? "request-note-error" : undefined
              }
            />
            {Option.isSome(noteProblem) ? (
              <FieldError id="request-note-error">
                {noteProblem.value}
              </FieldError>
            ) : null}
          </Field>
          {Option.isSome(problem) ? (
            <p role="alert" className="text-body text-destructive">
              {problem.value}
            </p>
          ) : null}
        </main>
        <ScreenActions>
          <Button
            className="w-full"
            type="submit"
            data-testid="create-request"
            disabled={creating || Option.isNone(parsed)}
          >
            {creating
              ? m.payment_request_creating()
              : m.payment_request_create()}
          </Button>
          <Button
            className="w-full"
            variant="ghost"
            nativeButton={false}
            render={<Link to="/links" data-testid="view-links" />}
          >
            {m.payment_request_view_links()}
          </Button>
        </ScreenActions>
      </form>
      <RequestShareModal sharing={sharing} />
    </>
  );
}
