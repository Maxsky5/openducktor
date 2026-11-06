import { FolderX, Loader2 } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  TASK_REMOVE_WORKTREE_COPY as COPY,
  taskRemoveWorktreeConfirmLabel,
  taskRemoveWorktreeEffectLines,
} from "@openducktor/frontend-core/tasks/details/task-close-copy";
import { TaskCleanupTargets, TaskReadError } from "./task-close-confirm-content";
import { TaskDialogHeader } from "./task-dialog-header";
import { focusDialogContent } from "@/lib/focus-dialog-content";
import type { TaskRemoveWorktreeConfirmDialogModel } from "@openducktor/frontend-core/tasks/details/use-task-remove-worktree-confirm-dialog";

/** Removes the worktree and the local task branch of a closed task. */
export function TaskRemoveWorktreeConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  operation,
  taskId,
  impact,
  isPreparing,
  confirmDisabled,
}: TaskRemoveWorktreeConfirmDialogModel): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        loading={isPreparing && !operation.isPending}
        loadingLabel="Loading worktree details…"
        className="max-w-lg overflow-hidden p-0"
        onOpenAutoFocus={focusDialogContent}
      >
        <TaskDialogHeader
          title={COPY.title}
          description="Delete the local checkout and branch. The task stays closed."
          subject={{ id: taskId, title: null }}
          icon={FolderX}
        />

        <DialogBody className="grid min-h-0 gap-4 overflow-y-auto px-6 pb-6 text-sm">
          <div className="rounded-lg border border-border p-3">
            <TaskCleanupTargets impact={impact} removes />
          </div>
          <div className="flex flex-col gap-2 text-muted-foreground">
            {taskRemoveWorktreeEffectLines(impact).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
          <TaskReadError read={impact} />
          {operation.error ? (
            <p className="whitespace-pre-line text-destructive-muted">{operation.error}</p>
          ) : null}
        </DialogBody>

        <DialogFooter className="mt-0 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" disabled={operation.isPending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={confirmDisabled}
            aria-busy={operation.isPending}
            onClick={onConfirm}
          >
            {operation.isPending ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <FolderX data-icon="inline-start" />
            )}
            {taskRemoveWorktreeConfirmLabel(operation.isPending)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
