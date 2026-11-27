import { useEffect, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import * as Option from "effect/Option";

import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from "@/components/modal";

import { memoByteLimit, memoBytes } from "./intent";

import { m } from "@/paraglide/messages";

export function MemoModal({
  open,
  memo,
  problem,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  memo: string;
  problem: Option.Option<string>;
  onOpenChange: (open: boolean) => void;
  onSave: (memo: string) => void;
}) {
  const [draft, setDraft] = useState(memo);

  useEffect(() => {
    if (open) setDraft(memo);
  }, [open, memo]);

  const save = (value: string) => {
    onSave(value);
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save(draft.trim());
          }}
        >
          <ModalHeader>
            <ModalTitle>{m.common_memo()}</ModalTitle>
            <ModalDescription>{m.send_memo_description()}</ModalDescription>
          </ModalHeader>
          <div className="px-4">
            <Field>
              <FieldLabel htmlFor="memo">{m.common_memo()}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="memo"
                  name="memo"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoFocus
                  aria-invalid={Option.isSome(problem) ? true : undefined}
                  aria-describedby={
                    Option.isSome(problem) ? "memo-error" : undefined
                  }
                />
                <InputGroupAddon align="inline-end">
                  <span className="text-label tabular-nums">
                    {memoBytes(draft)}/{memoByteLimit}
                  </span>
                </InputGroupAddon>
              </InputGroup>
              {Option.isSome(problem) ? (
                <FieldError id="memo-error">{problem.value}</FieldError>
              ) : null}
            </Field>
          </div>
          <ModalFooter>
            <Button className="w-full" type="submit" data-testid="save-memo">
              {m.send_save_memo()}
            </Button>
            {memo === "" ? null : (
              <Button
                className="w-full"
                type="button"
                variant="secondary"
                onClick={() => save("")}
              >
                {m.send_remove_memo()}
              </Button>
            )}
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
