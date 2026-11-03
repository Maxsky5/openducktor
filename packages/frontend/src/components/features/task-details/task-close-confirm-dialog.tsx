import { CircleCheckBig, Loader2 } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import {
  TASK_CLOSE_COPY,
  taskCloseConfirmLabel,
} from "@openducktor/frontend-core/tasks/details/task-close-copy";
import { TaskCloseConfirmContent } from "./task-close-confirm-content";
import { focusDialogContent } from "@/lib/focus-dialog-content";
import { TaskDialogHeader } from "./task-dialog-header";
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
        loading={isPreparing && !operation.isPending}
        loadingLabel="Loading task details…"
        className="max-w-lg overflow-hidden p-0"
        onOpenAutoFocus={focusDialogContent}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <TaskDialogHeader
          title={TASK_CLOSE_COPY.title}
          description={TASK_CLOSE_COPY.description}
          subject={{ id: impact.taskId, title: impact.taskTitle }}
          icon={CircleCheckBig}
        />

        <DialogBody className="grid min-h-0 gap-4 overflow-y-auto px-6 pb-6">
          <TaskCloseConfirmContent
            impact={impact}
            removeWorktree={removeWorktree}
            onRemoveWorktreeChange={onRemoveWorktreeChange}
            disabled={operation.isPending}
          />
          {operation.error ? (
            <p className="text-sm text-destructive-muted">{operation.error}</p>
          ) : null}
        </DialogBody>

        <DialogFooter className="mt-0 border-t border-border px-6 py-4">
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
