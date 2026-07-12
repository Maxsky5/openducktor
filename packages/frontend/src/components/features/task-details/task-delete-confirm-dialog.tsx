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
import {
  formatManagedSessionCleanupLoadingMessage,
  formatManagedSessionCleanupMessage,
  formatUnknownManagedSessionCleanupMessage,
} from "./task-cleanup-impact-model";

type TaskDeleteConfirmDialogProps = {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  taskId: string;
  subtasksCount: number;
  impact: {
    hasSubtasks: boolean;
    isLoading: boolean;
    hasManagedSessionCleanup: boolean;
    managedWorktreeCount: number;
    terminalCount: number;
    error: string | null;
  };
  deletion: {
    isPending: boolean;
    error: string | null;
  };
};

export function TaskDeleteConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  taskId,
  subtasksCount,
  impact,
  deletion,
}: TaskDeleteConfirmDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete Task</DialogTitle>
          <DialogDescription>
            {impact.hasSubtasks
              ? `Delete ${taskId} and its ${subtasksCount} direct subtask${subtasksCount === 1 ? "" : "s"}? This cannot be undone.`
              : `Delete ${taskId}? This cannot be undone.`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pt-4">
          <div className="space-y-2 rounded-lg border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-surface-foreground">
            <p className="font-medium">This action permanently removes the task.</p>
            {impact.hasSubtasks ? (
              <p>
                Direct subtasks will also be deleted to avoid orphaned children in the workflow.
              </p>
            ) : null}
            <p>
              {impact.terminalCount === 0
                ? "No running task terminals will be stopped."
                : `${impact.terminalCount} associated terminal${impact.terminalCount === 1 ? "" : "s"} will be terminated before deletion.`}
            </p>
            {impact.isLoading ? (
              <p>{formatManagedSessionCleanupLoadingMessage("delete")}</p>
            ) : impact.error ? (
              <p>{formatUnknownManagedSessionCleanupMessage()}</p>
            ) : impact.hasManagedSessionCleanup ? (
              <p>{formatManagedSessionCleanupMessage(impact.managedWorktreeCount)}</p>
            ) : null}
            {impact.error ? <p className="text-destructive-muted">{impact.error}</p> : null}
            {deletion.error ? <p className="text-destructive-muted">{deletion.error}</p> : null}
          </div>
        </DialogBody>

        <DialogFooter className="mt-0 flex flex-row justify-end gap-2 border-t border-border pt-5">
          <Button
            type="button"
            variant="outline"
            className="w-[132px] justify-center disabled:border-border disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            disabled={deletion.isPending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-[132px] justify-center disabled:bg-rose-400 disabled:text-rose-50 disabled:opacity-100"
            disabled={deletion.isPending || impact.isLoading}
            aria-busy={deletion.isPending || impact.isLoading}
            onClick={onConfirm}
          >
            {deletion.isPending || impact.isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {deletion.isPending ? "Deleting..." : impact.isLoading ? "Checking..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
