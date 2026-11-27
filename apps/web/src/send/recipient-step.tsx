import { useEffect, useRef } from "react";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { ScreenActions } from "@/components/screen";

import { type Destination, FieldProblem, recipientOf } from "./intent";

import { m } from "@/paraglide/messages";

export function RecipientStep({
  destination,
  recipient,
  problem,
  onEdit,
  onContinue,
  onProblem,
  onChangeDestination,
}: {
  destination: Destination;
  recipient: string;
  problem: Option.Option<FieldProblem>;
  onEdit: (recipient: string) => void;
  onContinue: () => void;
  onProblem: (problem: FieldProblem) => void;
  onChangeDestination: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);

  const message = problem.pipe(
    Option.filter((found) => found.field === "recipient"),
    Option.map((found) => found.message),
  );

  useEffect(() => {
    if (Option.isSome(message)) field.current?.focus();
  }, [problem]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    Result.match(recipientOf(destination, recipient.trim()), {
      onFailure: onProblem,
      onSuccess: onContinue,
    });
  };

  const control: React.ComponentProps<"input"> = {
    id: "recipient",
    name: "recipient",
    ref: field,
    value: recipient,
    onChange: (event) =>
      onEdit(
        destination === "username"
          ? event.target.value.toLowerCase()
          : event.target.value,
      ),
    autoComplete: "off",
    autoCapitalize: "none",
    spellCheck: false,
    autoFocus: true,
    "aria-invalid": Option.isSome(message) ? true : undefined,
    "aria-describedby": Option.isSome(message) ? "recipient-error" : undefined,
  };

  return (
    <form className="flex flex-1 flex-col" noValidate onSubmit={submit}>
      <main className="flex flex-1 flex-col gap-6 px-5 pt-2">
        <h1 className="font-display text-h1">
          {destination === "username"
            ? m.send_recipient_username_title()
            : m.send_recipient_address_title()}
        </h1>
        <Field>
          <FieldLabel htmlFor="recipient">
            {destination === "username"
              ? m.send_username_label()
              : m.common_stellar_address()}
          </FieldLabel>
          {destination === "username" ? (
            <InputGroup>
              <InputGroupAddon>@</InputGroupAddon>
              <InputGroupInput {...control} />
            </InputGroup>
          ) : (
            <Input {...control} />
          )}
          <FieldDescription>
            {destination === "username"
              ? m.send_destination_username_note()
              : m.common_address_hint()}
          </FieldDescription>
          {Option.isSome(message) ? (
            <FieldError id="recipient-error">{message.value}</FieldError>
          ) : null}
        </Field>
      </main>
      <ScreenActions>
        <Button
          className="w-full"
          type="submit"
          data-testid="continue-recipient"
        >
          {m.send_continue()}
        </Button>
        <Button
          className="w-full"
          type="button"
          variant="secondary"
          onClick={onChangeDestination}
          data-testid="change-destination"
        >
          {m.common_change_destination()}
        </Button>
      </ScreenActions>
    </form>
  );
}
