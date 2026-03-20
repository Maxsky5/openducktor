import type { LucideIcon } from "lucide-react";
import { LoaderCircle } from "lucide-react";
import { memo, type ReactElement, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type GitConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  children: ReactNode;
  closeLabel?: string;
  closeDisabled: boolean;
  onClose: () => void;
  closeTestId: string;
  confirmLabel: string;
  confirmPendingLabel: string;
  confirmPending: boolean;
  confirmDisabled: boolean;
  onConfirm: () => void;
  confirmTestId: string;
  confirmIcon: LucideIcon;
  contentTestId: string;
};

export const GitConfirmationDialog = memo(function GitConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  closeLabel = "Close",
  closeDisabled,
  onClose,
  closeTestId,
  confirmLabel,
  confirmPendingLabel,
  confirmPending,
  confirmDisabled,
  onConfirm,
  confirmTestId,
  confirmIcon: ConfirmIcon,
  contentTestId,
}: GitConfirmationDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl overflow-hidden border border-border bg-card p-0 shadow-2xl"
        data-testid={contentTestId}
      >
        <div className="space-y-6 px-6 py-6 sm:px-8 sm:py-8">
          <DialogHeader className="space-y-3 pr-10">
            <DialogTitle className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {title}
            </DialogTitle>
            <DialogDescription className="max-w-[42rem] text-sm leading-7 text-muted-foreground sm:text-[15px]">
              {description}
            </DialogDescription>
          </DialogHeader>

          {children}
        </div>

        <DialogFooter className="mt-0 flex flex-col-reverse gap-3 border-t border-border bg-muted/20 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-5">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={closeDisabled}
            data-testid={closeTestId}
          >
            {closeLabel}
          </Button>
          <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
            <Button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              data-testid={confirmTestId}
            >
              {confirmPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ConfirmIcon className="size-4" />
              )}
              {confirmPending ? confirmPendingLabel : confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
