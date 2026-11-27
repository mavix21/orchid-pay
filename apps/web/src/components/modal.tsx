import { createContext, useContext } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@workspace/ui/components/drawer";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";

import { m } from "@/paraglide/messages";

type ModalPresentation = {
  readonly sheet: boolean;
  readonly dismissible: boolean;
};

const ModalPresentationContext = createContext<ModalPresentation>({
  sheet: true,
  dismissible: true,
});

export function Modal({
  open,
  onOpenChange,
  dismissible = true,
  children,
}: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  dismissible?: boolean;
  children: React.ReactNode;
}) {
  const sheet = useIsMobile();

  return (
    <ModalPresentationContext value={{ sheet, dismissible }}>
      {sheet ? (
        <Drawer
          open={open}
          onOpenChange={onOpenChange}
          showSwipeHandle={dismissible}
        >
          {children}
        </Drawer>
      ) : (
        <Dialog
          open={open}
          onOpenChange={onOpenChange}
          disablePointerDismissal={!dismissible}
        >
          {children}
        </Dialog>
      )}
    </ModalPresentationContext>
  );
}

export function ModalContent({
  testId,
  children,
}: {
  testId?: string;
  children: React.ReactNode;
}) {
  const { sheet, dismissible } = useContext(ModalPresentationContext);

  return sheet ? (
    <DrawerContent data-testid={testId}>{children}</DrawerContent>
  ) : (
    <DialogContent
      data-testid={testId}
      showCloseButton={dismissible}
      closeLabel={m.common_close()}
    >
      {children}
    </DialogContent>
  );
}

export function ModalHeader({ children }: { children: React.ReactNode }) {
  const { sheet } = useContext(ModalPresentationContext);

  return sheet ? (
    <DrawerHeader>{children}</DrawerHeader>
  ) : (
    <DialogHeader>{children}</DialogHeader>
  );
}

export function ModalTitle({ children }: { children: React.ReactNode }) {
  const { sheet } = useContext(ModalPresentationContext);

  return sheet ? (
    <DrawerTitle>{children}</DrawerTitle>
  ) : (
    <DialogTitle>{children}</DialogTitle>
  );
}

export function ModalDescription({
  testId,
  outcome,
  children,
}: {
  testId?: string;
  outcome?: string;
  children: React.ReactNode;
}) {
  const { sheet } = useContext(ModalPresentationContext);

  return sheet ? (
    <DrawerDescription data-testid={testId} data-outcome={outcome}>
      {children}
    </DrawerDescription>
  ) : (
    <DialogDescription data-testid={testId} data-outcome={outcome}>
      {children}
    </DialogDescription>
  );
}

export function ModalFooter({ children }: { children: React.ReactNode }) {
  const { sheet } = useContext(ModalPresentationContext);

  return sheet ? (
    <DrawerFooter>{children}</DrawerFooter>
  ) : (
    <DialogFooter>{children}</DialogFooter>
  );
}
