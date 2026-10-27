import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type { CloseTaskOptions } from "../../types/task-close";
import type { TaskConfirmDialogState } from "./task-confirm-dialog-types";
import { useTaskAsyncConfirmDialog } from "./use-task-async-confirm-dialog";
import {
  isCloseBlocked,
  type TaskCloseImpact,
  useTaskCloseChoice,
  useTaskCloseImpact,
  useTaskCloseLoader,
} from "./use-task-close-impact";

export type CloseTaskRun = (taskId: string, options: CloseTaskOptions) => Promise<void>;

export type TaskCloseConfirmDialogModel = Omit<TaskConfirmDialogState, "impact"> & {
  impact: TaskCloseImpact;
  /** The reads still run, so the dialog shows its one loader in place of the content. */
  isPreparing: boolean;
  /** Null while the default choice loads. */
  removeWorktree: boolean | null;
  onRemoveWorktreeChange: (removeWorktree: boolean) => void;
  confirmDisabled: boolean;
};

export type UseTaskCloseConfirmDialogResult = {
  openDialog: () => void;
  dialog: TaskCloseConfirmDialogModel;
};

type UseTaskCloseConfirmDialogOptions = {
  task: Pick<TaskCard, "id" | "title" | "removeWorktreeOnClose">;
  /** The dialog can open only while this is true. The details sheet passes its open state. */
  enabled: boolean;
  initiallyOpen?: boolean;
  /** The close. Without it, Confirm does nothing. */
  run: CloseTaskRun | undefined;
  onSucceeded: () => void;
};

/** The shared close confirmation of a task, with its cleanup choice. */
export function useTaskCloseConfirmDialog({
  task,
  enabled,
  initiallyOpen = false,
  run,
  onSucceeded,
}: UseTaskCloseConfirmDialogOptions): UseTaskCloseConfirmDialogResult {
  const { removeWorktree, onRemoveWorktreeChange, resetChoice } = useTaskCloseChoice(
    task.removeWorktreeOnClose,
  );
  const { openDialog, dialog } = useTaskAsyncConfirmDialog({
    enabled,
    initiallyOpen,
    scopeKey: task.id,
    run: run && removeWorktree !== null ? () => run(task.id, { removeWorktree }) : undefined,
    onSucceeded,
  });
  const impact = useTaskCloseImpact({ task, enabled: dialog.open });
  const isPreparing = useTaskCloseLoader(impact);
  return {
    openDialog: () => {
      resetChoice();
      openDialog();
    },
    dialog: {
      ...dialog,
      impact,
      isPreparing,
      removeWorktree,
      onRemoveWorktreeChange,
      // Confirm waits for the loader, so the user sees what the close does first.
      confirmDisabled:
        isPreparing || dialog.operation.isPending || isCloseBlocked(impact, removeWorktree),
    },
  };
}
