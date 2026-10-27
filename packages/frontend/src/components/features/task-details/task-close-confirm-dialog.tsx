import { CircleCheckBig, Loader2 } from "lucide-react";
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
  TASK_CLOSE_COPY,
  taskCloseConfirmLabel,
} from "@openducktor/frontend-core/tasks/details/task-close-copy";
import { TaskCloseConfirmContent } from "./task-close-confirm-content";
import { focusDialogContent } from "@/lib/focus-dialog-content";
import { TaskIdentity } from "./task-identity";
import { TaskReadsLoading } from "./task-reads-loading";
import type { TaskCloseConfirmDialogModel } from "@openducktor/frontend-core/tasks/details/use-task-close-confirm-dialog";

type TaskCloseConfirmDialogProps = TaskCloseConfirmDialogModel & {
  /** Runs after the dialog closed and its exit animation ended. */
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
};

/** The shared close confirmation of the details sheet, Kanban cards, and the session header. */
export function TaskCloseConfirmDialog({
  open,
  onOpenChange,
  onCancel,
  onConfirm,
  operation,
  impact,
  isPreparing,
  removeWorktree,
  onRemoveWorktreeChange,
  confirmDisabled,
  onCloseAutoFocus,
}: TaskCloseConfirmDialogProps): ReactElement {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg"
        onOpenAutoFocus={focusDialogContent}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{TASK_CLOSE_COPY.title}</DialogTitle>
          <DialogDescription asChild>
            <TaskIdentity title={impact.taskTitle} taskId={impact.taskId} />
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4 py-4">
          {isPreparing ? (
            <TaskReadsLoading />
          ) : (
            <TaskCloseConfirmContent
              impact={impact}
              removeWorktree={removeWorktree}
              onRemoveWorktreeChange={onRemoveWorktreeChange}
              disabled={operation.isPending}
            />
          )}
          {operation.error ? (
            <p className="text-sm text-destructive-muted">{operation.error}</p>
          ) : null}
        </DialogBody>

        <DialogFooter className="mt-0 flex flex-row justify-between gap-2 border-t border-border pt-5">
          <Button type="button" variant="outline" disabled={operation.isPending} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="warning"
            disabled={confirmDisabled}
            aria-busy={operation.isPending}
            onClick={onConfirm}
          >
            {operation.isPending ? (
              <Loader2 className="animate-spin" data-icon="inline-start" />
            ) : (
              <CircleCheckBig data-icon="inline-start" />
            )}
            {taskCloseConfirmLabel(operation.isPending)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
