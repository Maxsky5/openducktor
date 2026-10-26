import { CircleCheckBig, Loader2 } from "lucide-react";
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
import { buildTaskCloseConfirmCopy } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import { TaskConfirmCopyLines } from "./task-confirm-copy-lines";
import type { TaskConfirmDialogProps } from "./task-confirm-dialog-types";

export function TaskCloseConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  task,
  impact,
  operation,
  onCloseAutoFocus,
}: TaskConfirmDialogProps): ReactElement {
  const copy = buildTaskCloseConfirmCopy(task, impact);
  const confirmButton = confirmButtonState(impact, operation, copy.confirmLabel);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>

        <DialogBody className="py-4">
          <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-surface-foreground">
            <TaskConfirmCopyLines lines={copy.lines} />
          </div>
          {impact.error ? <p className="mt-2 text-destructive-muted">{impact.error}</p> : null}
          {operation.error ? (
            <p className="mt-2 text-destructive-muted">{operation.error}</p>
          ) : null}
        </DialogBody>

        <DialogFooter className="mt-0 flex flex-row justify-between gap-2 border-t border-border pt-5">
          <Button type="button" variant="outline" disabled={operation.isPending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="warning"
            disabled={confirmButton.disabled}
            aria-busy={confirmButton.isBusy}
            onClick={onConfirm}
          >
            {confirmButton.isBusy ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <CircleCheckBig data-icon="inline-start" />
            )}
            {confirmButton.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
