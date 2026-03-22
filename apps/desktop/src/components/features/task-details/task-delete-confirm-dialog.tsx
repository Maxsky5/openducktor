import { Loader2, Trash2 } from "lucide-react";
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

type TaskDeleteConfirmDialogProps = {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  taskId: string;
  subtasksCount: number;
  hasSubtasks: boolean;
  isLoadingImpact: boolean;
  hasManagedSessionCleanup: boolean;
  managedWorktreeCount: number;
  impactError: string | null;
  isDeletePending: boolean;
  deleteError: string | null;
};

export const formatManagedSessionCleanupMessage = (managedWorktreeCount: number): string => {
  if (managedWorktreeCount > 0) {
    return `${managedWorktreeCount} linked task worktree${managedWorktreeCount === 1 ? "" : "s"} and their related local branches will also be deleted. Any uncommitted changes in those worktrees will be lost.`;
  }

  return "Linked task worktrees and their related local branches will also be deleted if they exist. Any uncommitted changes in those worktrees will be lost.";
};

export const formatUnknownManagedSessionCleanupMessage = (): string =>
  "Linked task worktrees and their related local branches may also be deleted. Any uncommitted changes in those worktrees will be lost.";

export const formatManagedSessionCleanupLoadingMessage = (): string =>
  "Checking linked task worktree cleanup impact before deletion.";

export function TaskDeleteConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  taskId,
  subtasksCount,
  hasSubtasks,
  isLoadingImpact,
  hasManagedSessionCleanup,
  managedWorktreeCount,
  impactError,
  isDeletePending,
  deleteError,
}: TaskDeleteConfirmDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete Task</DialogTitle>
          <DialogDescription>
            {hasSubtasks
              ? `Delete ${taskId} and its ${subtasksCount} direct subtask${subtasksCount === 1 ? "" : "s"}? This cannot be undone.`
              : `Delete ${taskId}? This cannot be undone.`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pt-4">
          <div className="space-y-2 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-surface-foreground">
            <p className="font-medium">This action permanently removes the task from Beads.</p>
            {hasSubtasks ? (
              <p>
                Direct subtasks will also be deleted to avoid orphaned children in the workflow.
              </p>
            ) : null}
            {isLoadingImpact ? (
              <p>{formatManagedSessionCleanupLoadingMessage()}</p>
            ) : impactError ? (
              <p>{formatUnknownManagedSessionCleanupMessage()}</p>
            ) : hasManagedSessionCleanup ? (
              <p>{formatManagedSessionCleanupMessage(managedWorktreeCount)}</p>
            ) : null}
            {impactError ? <p className="text-destructive-muted">{impactError}</p> : null}
            {deleteError ? <p className="text-destructive-muted">{deleteError}</p> : null}
          </div>
        </DialogBody>

        <DialogFooter className="mt-0 flex flex-row justify-end gap-2 border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            className="w-[132px] justify-center disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            disabled={isDeletePending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-[132px] justify-center disabled:bg-rose-400 disabled:text-rose-50 disabled:opacity-100"
            disabled={isDeletePending || isLoadingImpact}
            aria-busy={isDeletePending || isLoadingImpact}
            onClick={onConfirm}
          >
            {isDeletePending || isLoadingImpact ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {isDeletePending ? "Deleting..." : isLoadingImpact ? "Checking..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
