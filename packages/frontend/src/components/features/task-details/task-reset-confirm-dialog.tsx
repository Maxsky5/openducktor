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
  formatManagedSessionCleanupLoadingMessage,
  formatManagedSessionCleanupMessage,
  formatUnknownManagedSessionCleanupMessage,
} from "./task-cleanup-impact-model";

type TaskResetConfirmDialogProps = {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  taskId: string;
  impact: {
    isLoading: boolean;
    isLoadingStopImpact: boolean;
    hasManagedSessionCleanup: boolean;
    managedWorktreeCount: number;
    terminalCount: number;
    activeSessionCount: number | null;
    activeSessionCountError: string | null;
    error: string | null;
  };
  reset: {
    isPending: boolean;
    error: string | null;
  };
};

export function TaskResetConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  taskId,
  impact,
  reset,
}: TaskResetConfirmDialogProps): ReactElement {
  const isImpactLoading = impact.isLoading || impact.isLoadingStopImpact;
  let confirmLabel = "Reset task";
  if (reset.isPending) {
    confirmLabel = "Resetting...";
  } else if (isImpactLoading) {
    confirmLabel = "Checking...";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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
            {impact.isLoading ? (
              <p>{formatManagedSessionCleanupLoadingMessage("reset")}</p>
            ) : impact.error ? (
              <p>{formatUnknownManagedSessionCleanupMessage()}</p>
            ) : impact.hasManagedSessionCleanup ? (
              <p>{formatManagedSessionCleanupMessage(impact.managedWorktreeCount)}</p>
            ) : (
              <p>
                Task-managed worktrees and related local branches will be deleted when present. Any
                uncommitted changes in those worktrees will be lost.
              </p>
            )}
          </div>
          {impact.error ? <p className="text-destructive-muted mt-2">{impact.error}</p> : null}
          {reset.error ? <p className="text-destructive-muted mt-2">{reset.error}</p> : null}
        </DialogBody>

        <DialogFooter className="mt-0 flex flex-row justify-between gap-2 border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            className="w-[132px] justify-center disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            disabled={reset.isPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-[132px] justify-center disabled:bg-destructive/80 disabled:text-destructive-foreground disabled:opacity-100"
            disabled={reset.isPending || isImpactLoading || impact.activeSessionCountError !== null}
            aria-busy={reset.isPending || isImpactLoading}
            onClick={onConfirm}
          >
            {reset.isPending || isImpactLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
