import { Loader2, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { TaskStopImpactNotice } from "@/components/features/task-details/task-stop-impact-notice";
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
import {
  formatActiveSessionStopLoadingMessage,
  formatCleanupImpactMessage,
  confirmButtonState,
} from "./task-cleanup-impact-model";
import type { TaskConfirmDialogProps } from "./task-confirm-dialog-types";

type TaskDeleteConfirmDialogProps = TaskConfirmDialogProps & { subtasksCount: number };

export function TaskDeleteConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  taskId,
  subtasksCount,
  impact,
  operation,
  onCloseAutoFocus,
}: TaskDeleteConfirmDialogProps): ReactElement {
  const hasSubtasks = subtasksCount > 0;
  const cleanupMessage = formatCleanupImpactMessage(impact, "delete");
  const confirmButton = confirmButtonState(impact, operation, {
    idle: "Delete",
    pending: "Deleting...",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Delete Task</DialogTitle>
          <DialogDescription>
            {hasSubtasks
              ? `Delete ${taskId} and its ${subtasksCount} direct subtask${subtasksCount === 1 ? "" : "s"}? This cannot be undone.`
              : `Delete ${taskId}? This cannot be undone.`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="py-4">
          <div className="space-y-2 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-surface-foreground">
            <p className="font-medium">This action permanently removes the task.</p>
            {hasSubtasks ? (
              <p>
                Direct subtasks will also be deleted to avoid orphaned children in the workflow.
              </p>
            ) : (
              <p>Any descendant subtasks will also be deleted to avoid orphaned children.</p>
            )}
            {impact.terminalCount === 0 ? null : (
              <p>
                {impact.terminalCount} associated terminal
                {impact.terminalCount === 1 ? "" : "s"} will be terminated before deletion.
              </p>
            )}
            <TaskStopImpactNotice
              count={impact.activeSessionCount}
              error={impact.activeSessionCountError}
              operation="delete"
            />
            {impact.isLoadingStopImpact ? (
              <p>{formatActiveSessionStopLoadingMessage("delete")}</p>
            ) : null}
            {cleanupMessage ? <p>{cleanupMessage}</p> : null}
            {impact.error ? <p className="text-destructive-muted">{impact.error}</p> : null}
            {operation.error ? <p className="text-destructive-muted">{operation.error}</p> : null}
          </div>
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
            className="w-[132px] justify-center disabled:bg-rose-400 disabled:text-rose-50 disabled:opacity-100"
            disabled={confirmButton.disabled}
            aria-busy={confirmButton.isBusy}
            onClick={onConfirm}
          >
            {confirmButton.isBusy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {confirmButton.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
