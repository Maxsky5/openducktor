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
  confirmDisabled,
  onConfirm,
  confirmTestId,
  confirmIcon: ConfirmIcon,
  contentTestId,
}: GitConfirmationDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl overflow-hidden p-0" data-testid={contentTestId}>
        <div className="space-y-6 px-6 py-6 sm:px-7 sm:py-7">
          <DialogHeader className="space-y-3 pr-10">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="max-w-[38rem] text-[15px] leading-7">
              {description}
            </DialogDescription>
          </DialogHeader>

          {children}
        </div>

        <DialogFooter className="mt-0 flex flex-row items-center justify-between border-t border-border px-6 py-5 sm:px-7">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={closeDisabled}
            data-testid={closeTestId}
          >
            {closeLabel}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={onConfirm}
              disabled={confirmDisabled}
              data-testid={confirmTestId}
            >
              {confirmDisabled ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <ConfirmIcon className="size-4" />
              )}
              {confirmDisabled ? confirmPendingLabel : confirmLabel}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
