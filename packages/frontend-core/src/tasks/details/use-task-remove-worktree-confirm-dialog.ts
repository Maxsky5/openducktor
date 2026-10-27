import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { useMinimumLoader } from "../../lib/use-minimum-loader";
import type { TaskConfirmDialogState } from "./task-confirm-dialog-types";
import { useTaskAsyncConfirmDialog } from "./use-task-async-confirm-dialog";
import {
  isReadBlocked,
  type TaskReadState,
  type TaskWorktreeImpact,
  useTaskWorktreeImpact,
} from "./use-task-close-impact";

export type TaskRemoveWorktreeConfirmDialogModel = Omit<TaskConfirmDialogState, "impact"> & {
  taskId: string;
  impact: TaskWorktreeImpact;
  /** The reads still run, so the dialog shows its one loader in place of the content. */
  isPreparing: boolean;
  confirmDisabled: boolean;
};

export type UseTaskRemoveWorktreeConfirmDialogResult = {
  isAvailable: boolean;
  /** The sheet read failed, so the sheet shows the error with a retry. */
  sheetReadError: TaskReadState | null;
  openDialog: () => void;
  dialog: TaskRemoveWorktreeConfirmDialogModel;
};

/**
 * The worktree removal of a closed task. The details sheet reads the worktree while it shows a
 * closed task, so the action shows only when a worktree or a task branch remains.
 */
export function useTaskRemoveWorktreeConfirmDialog({
  task,
  enabled,
  run,
}: {
  task: Pick<TaskCard, "id" | "availableActions">;
  /** The details sheet passes its open state. */
  enabled: boolean;
  run: ((taskId: string) => Promise<void>) | undefined;
}): UseTaskRemoveWorktreeConfirmDialogResult {
  const canRemove =
    enabled && run !== undefined && task.availableActions.includes("remove_worktree");
  const { openDialog, dialog } = useTaskAsyncConfirmDialog({
    enabled: canRemove,
    scopeKey: task.id,
    run: run ? () => run(task.id) : undefined,
    onSucceeded: keepSheetOpen,
  });
  // The sheet reads the worktree to show the action. Each confirmation reads it again, because
  // the worktree can change while the sheet stays open, and the removal deletes its files. A new
  // read observer reports its fetch from its first render, so Confirm never sees old data.
  const sheetImpact = useTaskWorktreeImpact({ taskId: task.id, enabled: canRemove });
  const impact = useTaskWorktreeImpact({ taskId: task.id, enabled: canRemove && dialog.open });
  const isPreparing = useMinimumLoader(!impact.isReady);
  // The action stays while the confirmation reads again. Only a successful read that finds no
  // worktree and no branch hides it. A failed read keeps it and shows the error in the sheet.
  const hasWorktree = sheetImpact.worktreePaths.length > 0 || sheetImpact.branchNames.length > 0;
  const sheetReadFailed = canRemove && sheetImpact.error !== null;
  return {
    isAvailable: canRemove && (hasWorktree || sheetReadFailed),
    sheetReadError: sheetReadFailed ? sheetImpact : null,
    openDialog,
    dialog: {
      ...dialog,
      taskId: task.id,
      impact,
      isPreparing,
      // Confirm waits for the loader, so the user sees what the removal deletes first.
      confirmDisabled: isPreparing || dialog.operation.isPending || isReadBlocked(impact),
    },
  };
}

const keepSheetOpen = (): void => {};
