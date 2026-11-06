import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { useMemo } from "react";
import { useTaskStopImpact } from "../../queries/use-task-stop-impact";
import { useTaskWorktreeOwners } from "../../queries/use-task-worktree-owners";
import type { TaskConfirmAction } from "../workflow/task-confirm-actions";
import { buildTaskConfirmImpact } from "./task-cleanup-impact-model";
import { collectSingleTaskCleanupImpactTaskIds } from "./task-details-sheet-model";
import { useConfirmedImpact } from "./use-confirmed-impact";
import { useTaskCleanupImpact } from "./use-task-cleanup-impact";
import type { TaskConfirmDialogState } from "./task-confirm-dialog-types";
import { useTaskAsyncConfirmDialog } from "./use-task-async-confirm-dialog";

type UseTaskConfirmDialogOptions<Result> = {
  action: TaskConfirmAction;
  task: TaskCard | null;
  /** The dialog can open only while this is true. The details sheet passes its open state. */
  enabled: boolean;
  initiallyOpen?: boolean;
  /** The action. Without it, Confirm does nothing. */
  run: ((taskId: string) => Promise<Result>) | undefined;
  onSucceeded: () => void;
  onCommitted?: ((result: Result) => Promise<void>) | undefined;
  taskCleanupImpactHook?: typeof useTaskCleanupImpact;
  taskStopImpactHook?: typeof useTaskStopImpact;
  taskWorktreeOwnersHook?: typeof useTaskWorktreeOwners;
};

export type TaskConfirmDialog<Result = unknown> = {
  openDialog: (onCommitted?: (result: Result) => Promise<void>) => void;
  dialog: TaskConfirmDialogState;
};

/** One confirmation of a task action, with the cleanup that the action runs. */
export function useTaskConfirmDialog<Result>({
  action,
  task,
  enabled,
  initiallyOpen = false,
  run,
  onSucceeded,
  onCommitted,
  taskCleanupImpactHook = useTaskCleanupImpact,
  taskStopImpactHook = useTaskStopImpact,
  taskWorktreeOwnersHook = useTaskWorktreeOwners,
}: UseTaskConfirmDialogOptions<Result>): TaskConfirmDialog<Result> {
  const taskId = task?.id ?? null;
  const impactTaskIds = useMemo(() => collectSingleTaskCleanupImpactTaskIds(task), [task]);
  const { openDialog, dialog } = useTaskAsyncConfirmDialog({
    enabled,
    initiallyOpen,
    scopeKey: taskId,
    run: taskId && run ? () => run(taskId) : undefined,
    onSucceeded,
    onCommitted,
  });
  const loadImpact = dialog.open && run !== undefined;
  const cleanup = taskCleanupImpactHook(impactTaskIds, loadImpact);
  const stop = taskStopImpactHook({
    taskIds: impactTaskIds,
    operation: action,
    enabled: loadImpact,
  });
  const owners = taskWorktreeOwnersHook({
    taskIds: impactTaskIds,
    operation: action,
    enabled: loadImpact,
  });

  const impact = useConfirmedImpact(buildTaskConfirmImpact(cleanup, stop, owners), dialog);

  return { openDialog, dialog: { ...dialog, impact } };
}
