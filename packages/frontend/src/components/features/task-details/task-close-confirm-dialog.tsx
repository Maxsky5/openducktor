import { CircleCheckBig, Loader2 } from "lucide-react";
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

export function TaskCloseConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  taskId,
  impact,
  operation,
  onCloseAutoFocus,
}: TaskConfirmDialogProps): ReactElement {
  const confirmButton = confirmButtonState(impact, operation, {
    idle: "Close task",
    pending: "Closing...",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Close Task</DialogTitle>
          <DialogDescription>Close {taskId} manually and move it to Done?</DialogDescription>
        </DialogHeader>

        <DialogBody className="py-4">
          <div className="flex flex-col gap-2 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-sm text-warning-surface-foreground">
            <p className="font-medium">
              This manual override moves the task to Done and bypasses unfinished workflow steps.
            </p>
            <p>No code is merged and no pull request is created, updated, or merged.</p>
            <p>{terminalStopMessage(impact.terminalCount)}</p>
            <TaskStopImpactNotice
              count={impact.activeSessionCount}
              error={impact.activeSessionCountError}
              operation="close"
            />
            {impact.isLoadingStopImpact ? (
              <p>{formatActiveSessionStopLoadingMessage("close")}</p>
            ) : null}
            <p>
              {formatCleanupImpactMessage(impact, "close") ??
                "Linked task worktrees and related local branches will be deleted when present. Any uncommitted changes in those worktrees will be lost."}
            </p>
            <p>The task record, documents, QA reports, and linked history are retained.</p>
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

function terminalStopMessage(terminalCount: number): string {
  if (terminalCount === 0) return "No running task terminals will be stopped.";
  const noun = terminalCount === 1 ? "terminal" : "terminals";
  return `${terminalCount} task ${noun}, including action terminals, will be stopped before the task closes.`;
}
