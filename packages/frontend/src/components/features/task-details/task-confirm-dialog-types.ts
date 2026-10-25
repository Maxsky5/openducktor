import type { TaskConfirmSubject } from "@openducktor/frontend-core/tasks/details/task-confirm-copy";
import type { TaskConfirmDialogState } from "@openducktor/frontend-core/tasks/details/task-confirm-dialog-types";

/** The props that each task confirmation dialog shares. */
export type TaskConfirmDialogProps = TaskConfirmDialogState & {
  task: TaskConfirmSubject;
  /** Runs after the dialog closed and its exit animation ended. */
  onCloseAutoFocus?: ((event: Event) => void) | undefined;
};
