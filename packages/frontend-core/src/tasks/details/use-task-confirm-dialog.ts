import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { useMemo } from "react";
import { useTaskStopImpact } from "../../queries/use-task-stop-impact";
import type { TaskConfirmAction } from "../workflow/task-confirm-actions";
import { buildTaskConfirmImpact } from "./task-cleanup-impact-model";
import { collectSingleTaskCleanupImpactTaskIds } from "./task-details-sheet-model";
import { useTaskCleanupImpact } from "./use-task-cleanup-impact";
import type { TaskConfirmDialogState } from "./task-confirm-dialog-types";
import { useTaskAsyncConfirmDialog } from "./use-task-async-confirm-dialog";

type UseTaskConfirmDialogOptions = {
  action: TaskConfirmAction;
  task: TaskCard | null;
  /** The dialog can open only while this is true. The details sheet passes its open state. */
  enabled: boolean;
  initiallyOpen?: boolean;
  /** The action. Without it, Confirm does nothing. */
  run: ((taskId: string) => Promise<void>) | undefined;
  onSucceeded: () => void;
  taskCleanupImpactHook?: typeof useTaskCleanupImpact;
  taskStopImpactHook?: typeof useTaskStopImpact;
};

export type TaskConfirmDialog = {
  openDialog: () => void;
  dialog: TaskConfirmDialogState;
};

/** One confirmation of a task action, with the cleanup that the action runs. */
export function useTaskConfirmDialog({
  action,
  task,
  enabled,
  initiallyOpen = false,
  run,
  onSucceeded,
  taskCleanupImpactHook = useTaskCleanupImpact,
  taskStopImpactHook = useTaskStopImpact,
}: UseTaskConfirmDialogOptions): TaskConfirmDialog {
  const taskId = task?.id ?? null;
  const impactTaskIds = useMemo(() => collectSingleTaskCleanupImpactTaskIds(task), [task]);
  const { openDialog, dialog } = useTaskAsyncConfirmDialog({
    enabled,
    initiallyOpen,
    scopeKey: taskId,
    run: taskId && run ? () => run(taskId) : undefined,
    onSucceeded,
  });
  const loadImpact = dialog.open && run !== undefined;
  const cleanup = taskCleanupImpactHook(impactTaskIds, loadImpact);
  const stop = taskStopImpactHook({
    taskIds: impactTaskIds,
    operation: action,
    enabled: loadImpact,
  });

  return {
    openDialog,
    dialog: { ...dialog, impact: buildTaskConfirmImpact(cleanup, stop) },
  };
}
