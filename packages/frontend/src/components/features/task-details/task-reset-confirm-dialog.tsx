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
import {
  formatManagedSessionCleanupLoadingMessage,
  formatManagedSessionCleanupMessage,
  formatUnknownManagedSessionCleanupMessage,
} from "./task-delete-confirm-dialog";

type TaskResetConfirmDialogProps = {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  taskId: string;
  isLoadingImpact: boolean;
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  impactError: string | null;
  isResetPending: boolean;
  resetError: string | null;
};

export function TaskResetConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  taskId,
  isLoadingImpact,
  hasManagedSessionCleanup,
  managedWorktreeCount,
  impactError,
  isResetPending,
  resetError,
}: TaskResetConfirmDialogProps): ReactElement {
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
            {isLoadingImpact ? (
              <p>{formatManagedSessionCleanupLoadingMessage()}</p>
            ) : impactError ? (
              <p>{formatUnknownManagedSessionCleanupMessage()}</p>
            ) : hasManagedSessionCleanup ? (
              <p>{formatManagedSessionCleanupMessage(managedWorktreeCount)}</p>
            ) : (
              <p>
                Task-managed worktrees and related local branches will be deleted when present. Any
                uncommitted changes in those worktrees will be lost.
              </p>
            )}
          </div>
          {impactError ? <p className="text-destructive-muted mt-2">{impactError}</p> : null}
          {resetError ? <p className="text-destructive-muted mt-2">{resetError}</p> : null}
        </DialogBody>

        <DialogFooter className="mt-0 flex flex-row justify-between gap-2 border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            className="w-[132px] justify-center disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            disabled={isResetPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-[132px] justify-center disabled:bg-destructive/80 disabled:text-destructive-foreground disabled:opacity-100"
            disabled={isResetPending || isLoadingImpact}
            aria-busy={isResetPending || isLoadingImpact}
            onClick={onConfirm}
          >
            {isResetPending || isLoadingImpact ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RotateCcw className="size-4" />
            )}
            {isResetPending ? "Resetting..." : isLoadingImpact ? "Checking..." : "Reset task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
