import { FolderX, Loader2 } from "lucide-react";
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
  TASK_REMOVE_WORKTREE_COPY as COPY,
  taskRemoveWorktreeConfirmLabel,
  taskRemoveWorktreeDescription,
  taskRemoveWorktreeEffectLines,
} from "@openducktor/frontend-core/tasks/details/task-close-copy";
import { TaskCleanupTargets, TaskReadError } from "./task-close-confirm-content";
import { TaskReadsLoading } from "./task-reads-loading";
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{COPY.title}</DialogTitle>
          <DialogDescription>{taskRemoveWorktreeDescription(taskId)}</DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4 py-4 text-sm">
          {isPreparing ? (
            <TaskReadsLoading />
          ) : (
            <>
              {/* The close cleanup card shows the same rows. */}
              <div className="rounded-lg border border-border p-3">
                <TaskCleanupTargets impact={impact} removes />
              </div>
              <div className="space-y-1 text-muted-foreground">
                {taskRemoveWorktreeEffectLines(impact).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              <TaskReadError read={impact} />
            </>
          )}
          {operation.error ? <p className="text-destructive-muted">{operation.error}</p> : null}
        </DialogBody>

        <DialogFooter className="mt-0 flex flex-row justify-between gap-2 border-t border-border pt-5">
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
