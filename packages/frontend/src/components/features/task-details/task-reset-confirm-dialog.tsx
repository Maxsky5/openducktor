import { Loader2, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { confirmButtonState } from "@openducktor/frontend-core/tasks/details/task-cleanup-impact-model";
import { buildTaskResetConfirmCopy } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { TaskConfirmCopyLines } from "./task-confirm-copy-lines";
import type { TaskConfirmDialogProps } from "./task-confirm-dialog-types";

export function TaskResetConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  task,
  impact,
  operation,
  onCloseAutoFocus,
}: TaskConfirmDialogProps): ReactElement {
  const copy = buildTaskResetConfirmCopy(task, impact);
  const confirmButton = confirmButtonState(impact, operation, copy.confirmLabel);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="py-4">
          <div className="space-y-2 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-surface-foreground">
            <TaskConfirmCopyLines lines={copy.lines} />
          </div>
          {impact.error ? <p className="text-destructive-muted mt-2">{impact.error}</p> : null}
          {operation.error ? (
            <p className="text-destructive-muted mt-2">{operation.error}</p>
          ) : null}
        </DialogBody>

        <DialogFooter className="mt-0 flex flex-row justify-between gap-2 border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            className="w-[132px] justify-center disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            disabled={operation.isPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-[132px] justify-center disabled:bg-destructive/80 disabled:text-destructive-foreground disabled:opacity-100"
            disabled={confirmButton.disabled}
            aria-busy={confirmButton.isBusy}
            onClick={onConfirm}
          >
            {confirmButton.isBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {confirmButton.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
