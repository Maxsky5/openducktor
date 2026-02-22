import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Trash2 } from "lucide-react";
import type { ReactElement } from "react";

type TaskDeleteConfirmDialogProps = {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  taskId: string;
  subtasksCount: number;
  hasSubtasks: boolean;
  isDeletePending: boolean;
  deleteError: string | null;
};

export function TaskDeleteConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  taskId,
  subtasksCount,
  hasSubtasks,
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

        <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <p className="font-medium">This action permanently removes the task from Beads.</p>
          {hasSubtasks ? (
            <p>Direct subtasks will also be deleted to avoid orphaned children in the workflow.</p>
          ) : null}
          {deleteError ? <p className="text-rose-700">{deleteError}</p> : null}
        </div>

        <DialogFooter className="mt-6 flex flex-row justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="w-[132px] justify-center disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500 disabled:opacity-100"
            disabled={isDeletePending}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="w-[132px] justify-center disabled:bg-rose-400 disabled:text-rose-50 disabled:opacity-100"
            disabled={isDeletePending}
            aria-busy={isDeletePending}
            onClick={onConfirm}
          >
            {isDeletePending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {isDeletePending ? "Deleting..." : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
