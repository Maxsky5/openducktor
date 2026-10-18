import { Loader2, RotateCcw } from "lucide-react";
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

export function TaskResetConfirmDialog({
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
    idle: "Reset task",
    pending: "Resetting...",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Reset Task</DialogTitle>
          <DialogDescription>
            Reset {taskId} back to Backlog? This permanently clears linked workflow artifacts.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="py-4">
          <div className="space-y-2 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-surface-foreground">
            <p className="font-medium">
              This action moves the task back to Backlog and keeps the task record itself.
            </p>
            <p>Linked spec, plan, and QA documents will be removed.</p>
            <p>Linked spec, planner, builder, and QA sessions will be removed.</p>
            <p>Linked pull request and direct-merge metadata will be cleared.</p>
            {impact.terminalCount === 0 ? null : (
              <p>
                {impact.terminalCount} associated terminal
                {impact.terminalCount === 1 ? "" : "s"} will be terminated before the task resets.
              </p>
            )}
            <TaskStopImpactNotice
              count={impact.activeSessionCount}
              error={impact.activeSessionCountError}
              operation="reset"
            />
            {impact.isLoadingStopImpact ? (
              <p>{formatActiveSessionStopLoadingMessage("reset")}</p>
            ) : null}
            <p>
              {formatCleanupImpactMessage(impact, "reset") ??
                "Task-managed worktrees and related local branches will be deleted when present. Any uncommitted changes in those worktrees will be lost."}
            </p>
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
