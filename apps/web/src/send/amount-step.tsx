import { useRef, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import {
  type Amount,
  type Asset,
  type TransferIntent,
  parseAmount,
  precisionOf,
} from "@workspace/wallet";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { ScreenActions } from "@/components/screen";

import {
  type Destination,
  type FieldProblem,
  type SendField,
  type SendForm,
  intentOf,
} from "./intent";
import { AmountPad } from "./amount-pad";
import { MemoModal } from "./memo-modal";
import { shortAddress } from "./money";

import { m } from "@/paraglide/messages";

const messageFor = (problem: Option.Option<FieldProblem>, field: SendField) =>
  problem.pipe(
    Option.filter((found) => found.field === field),
    Option.map((found) => found.message),
  );

export function AmountStep({
  destination,
  form,
  problem,
  asset,
  available,
  onEdit,
  onIntent,
  onProblem,
  onChangeRecipient,
}: {
  destination: Destination;
  form: SendForm;
  problem: Option.Option<FieldProblem>;
  asset: Asset;
  available: Amount;
  onEdit: (field: SendField, value: string) => void;
  onIntent: (intent: TransferIntent) => void;
  onProblem: (problem: FieldProblem) => void;
  onChangeRecipient: () => void;
}) {
  const amountField = useRef<HTMLInputElement>(null);
  const memoProblem = messageFor(problem, "memo");
  const amountProblem = messageFor(problem, "amount");
  const [memoOpen, setMemoOpen] = useState(Option.isSome(memoProblem));

  const entered = Option.isSome(parseAmount(form.amount, precisionOf(asset)));

  const refuse = (found: FieldProblem) => {
    onProblem(found);

    if (found.field === "memo") setMemoOpen(true);

    if (found.field === "amount") amountField.current?.focus();
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    Result.match(intentOf(form, destination, asset), {
      onFailure: refuse,
      onSuccess: onIntent,
    });
  };

  const recipient = form.recipient.trim();

  return (
    <>
      <form className="flex flex-1 flex-col" noValidate onSubmit={submit}>
        <main className="flex flex-1 flex-col gap-4 px-5 pt-2">
          <button
            type="button"
            onClick={onChangeRecipient}
            aria-label={m.send_change_recipient()}
            data-testid="change-recipient"
            className="flex items-center gap-3 rounded-lg bg-secondary px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <span className="text-body text-muted-foreground">
              {m.common_to()}
            </span>
            <span className="truncate text-label-lg">
              {destination === "username"
                ? `@${recipient}`
                : shortAddress(recipient)}
            </span>
          </button>
          <AmountPad
            amount={form.amount}
            problem={amountProblem}
            asset={asset}
            available={available}
            field={amountField}
            onAmount={(amount) => onEdit("amount", amount)}
          />
        </main>
        <ScreenActions>
          <div className="flex w-full gap-2">
            {destination === "address" ? (
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={() => setMemoOpen(true)}
                data-testid="edit-memo"
              >
                {form.memo === "" ? m.send_add_memo() : m.send_edit_memo()}
              </Button>
            ) : null}
            <Button
              className="flex-1"
              type="submit"
              data-testid="review-payment"
              disabled={!entered}
            >
              {m.common_review()}
            </Button>
          </div>
        </ScreenActions>
      </form>
      {destination === "address" ? (
        <MemoModal
          open={memoOpen}
          memo={form.memo}
          problem={memoProblem}
          onOpenChange={setMemoOpen}
          onSave={(memo) => onEdit("memo", memo)}
        />
      ) : null}
    </>
  );
}
