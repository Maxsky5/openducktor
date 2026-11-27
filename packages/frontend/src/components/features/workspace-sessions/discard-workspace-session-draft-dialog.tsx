import { Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { focusDialogContent } from "@/lib/focus-dialog-content";

type DiscardWorkspaceSessionDraftDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
};

export function DiscardWorkspaceSessionDraftDialog({
  open,
  onOpenChange,
  onConfirm,
  onCloseAutoFocus,
}: DiscardWorkspaceSessionDraftDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md overflow-hidden p-0"
        onOpenAutoFocus={focusDialogContent}
        onCloseAutoFocus={(event) => onCloseAutoFocus?.(event)}
      >
        <DialogHeader className="px-6 pb-5 pt-6 pr-14">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Trash2 className="size-4" aria-hidden="true" />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle>Discard draft session?</DialogTitle>
              <DialogDescription className="leading-5">
                This removes your unsent message and configuration choices for this draft.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="mt-0 flex-row border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            Discard draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
