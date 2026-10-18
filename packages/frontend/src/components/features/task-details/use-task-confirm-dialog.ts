import type { TaskCard } from "@openducktor/contracts";
import { useMemo } from "react";
import {
  collectDeleteImpactTaskIds,
  collectSingleTaskCleanupImpactTaskIds,
  toSubtasks,
} from "@/components/features/task-details/task-details-sheet-model";
import { useTaskCleanupImpact } from "@/components/features/task-details/use-task-cleanup-impact";
import { useTaskStopImpact } from "@/state/queries/use-task-stop-impact";
import type { TaskConfirmAction, TaskConfirmDialogState } from "./task-confirm-dialog-types";
import { useTaskAsyncConfirmDialog } from "./use-task-async-confirm-dialog";

type UseTaskConfirmDialogOptions = {
  action: TaskConfirmAction;
  task: TaskCard | null;
  allTasks: TaskCard[];
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
  /** The direct subtasks of the task. Delete removes them too. */
  subtasksCount: number;
};

/** One confirmation of a task action, with the cleanup that the action runs. */
export function useTaskConfirmDialog({
  action,
  task,
  allTasks,
  enabled,
  initiallyOpen = false,
  run,
  onSucceeded,
  taskCleanupImpactHook = useTaskCleanupImpact,
  taskStopImpactHook = useTaskStopImpact,
}: UseTaskConfirmDialogOptions): TaskConfirmDialog {
  const taskId = task?.id ?? null;
  const taskById = useMemo(() => new Map(allTasks.map((entry) => [entry.id, entry])), [allTasks]);
  const subtasksCount = useMemo(() => toSubtasks(task, taskById).length, [task, taskById]);
  // Delete also removes the subtasks, so its cleanup covers them.
  const cleanupTaskIds = useMemo(
    () =>
      action === "delete"
        ? collectDeleteImpactTaskIds(task, taskById)
        : collectSingleTaskCleanupImpactTaskIds(task),
    [action, task, taskById],
  );
  const stopTaskIds = useMemo(() => collectSingleTaskCleanupImpactTaskIds(task), [task]);
  const { openDialog, dialog } = useTaskAsyncConfirmDialog({
    enabled,
    initiallyOpen,
    scopeKey: taskId,
    run: taskId && run ? () => run(taskId) : undefined,
    onSucceeded,
  });
  const loadImpact = dialog.open && run !== undefined;
  const cleanup = taskCleanupImpactHook(cleanupTaskIds, loadImpact);
  const stop = taskStopImpactHook({ taskIds: stopTaskIds, operation: action, enabled: loadImpact });

  return {
    openDialog,
    subtasksCount,
    dialog: {
      ...dialog,
      impact: {
        isLoading: cleanup.isLoadingImpact,
        isLoadingStopImpact: stop.isLoading,
        hasManagedSessionCleanup: cleanup.hasManagedSessionCleanup,
        managedWorktreeCount: cleanup.managedWorktreeCount,
        terminalCount: cleanup.terminalCount,
        activeSessionCount: stop.stoppableSessionCount,
        activeSessionCountError: stop.error,
        error: cleanup.impactError,
      },
    },
  };
}
