import type { TaskCard as WireTaskCard } from "@openducktor/contracts";
import {
  type TaskWorkflowContinuation,
  useTaskWorkflowContinuation,
} from "../workflow/task-workflow-continuation";
import {
  sessionRoleForViewAction,
  type WorkflowRoleId as AgentRole,
  type ResolvedTaskCard as TaskCard,
  type TaskWorkflowAction,
} from "@openducktor/workflows";
import { useCallback, useMemo } from "react";
import { useTaskStopImpact } from "../../queries/use-task-stop-impact";
import { useTaskWorktreeOwners } from "../../queries/use-task-worktree-owners";
import type { ActiveWorkspace } from "../../types/session-slices";
import type { SessionTargetOptions } from "../board/session-target-resolution";
import type { TaskWorkflowActions } from "../workflow/task-workflow-actions-context";
import { toTaskLabels } from "./task-details-sheet-model";
import { useTaskCleanupImpact } from "./use-task-cleanup-impact";
import {
  type UseTaskCloseConfirmDialogResult,
  useTaskCloseConfirmDialog,
} from "./use-task-close-confirm-dialog";
import { type TaskConfirmDialog, useTaskConfirmDialog } from "./use-task-confirm-dialog";
import {
  type UseTaskRemoveWorktreeConfirmDialogResult,
  useTaskRemoveWorktreeConfirmDialog,
} from "./use-task-remove-worktree-confirm-dialog";

export type TaskDetailsSheetViewModel = {
  taskId: string;
  deleteConfirm: TaskConfirmDialog;
  resetConfirm: TaskConfirmDialog;
  closeConfirm: UseTaskCloseConfirmDialogResult;
  removeWorktreeConfirm: UseTaskRemoveWorktreeConfirmDialogResult;
  taskLabels: string[];
  runWorkflowAction: (action: TaskWorkflowAction) => void;
};

export type UseTaskDetailsSheetViewModelOptions = {
  activeWorkspace?: ActiveWorkspace | null;
  task: TaskCard;
  /** The details view shows. Documents and confirmations load only while it is true. */
  open: boolean;
  /** Called with false after a confirmed action succeeds or a session view opens. */
  onOpenChange: (open: boolean) => void;
  runAction?: TaskWorkflowActions["runAction"] | undefined;
  onLaunch?: TaskWorkflowActions["onLaunch"] | undefined;
  resolveSessionOptionsByRole?: ((role: AgentRole) => SessionTargetOptions | undefined) | undefined;
  onResetTask?: TaskWorkflowActions["onResetTask"] | undefined;
  onCloseTask?: TaskWorkflowActions["onCloseTask"] | undefined;
  onRemoveTaskWorktree?: TaskWorkflowActions["onRemoveTaskWorktree"] | undefined;
  onDelete?: TaskWorkflowActions["onDelete"] | undefined;
  taskCleanupImpactHook?: typeof useTaskCleanupImpact;
  taskStopImpactHook?: typeof useTaskStopImpact;
  taskWorktreeOwnersHook?: typeof useTaskWorktreeOwners;
};

export function useTaskDetailsSheetViewModel({
  activeWorkspace,
  task,
  open,
  onOpenChange,
  runAction,
  onLaunch,
  resolveSessionOptionsByRole,
  onResetTask,
  onCloseTask,
  onRemoveTaskWorktree,
  onDelete,
  taskCleanupImpactHook = useTaskCleanupImpact,
  taskStopImpactHook = useTaskStopImpact,
  taskWorktreeOwnersHook = useTaskWorktreeOwners,
}: UseTaskDetailsSheetViewModelOptions): TaskDetailsSheetViewModel {
  const continueTaskWorkflow = useTaskWorkflowContinuation(activeWorkspace ?? null, onLaunch);
  const taskId = task.id;
  const taskLabels = useMemo(() => toTaskLabels(task.labels), [task.labels]);

  const confirmOptions = {
    task,
    enabled: open,
    onSucceeded: () => onOpenChange(false),
    taskCleanupImpactHook,
    taskStopImpactHook,
    taskWorktreeOwnersHook,
  };
  const deleteConfirm = useTaskConfirmDialog({
    ...confirmOptions,
    action: "delete",
    run: onDelete,
  });
  const resetConfirm = useTaskConfirmDialog({
    ...confirmOptions,
    action: "reset_task",
    run: onResetTask,
  });
  const closeConfirm = useTaskCloseConfirmDialog({
    task,
    enabled: open,
    run: onCloseTask,
    onSucceeded: () => onOpenChange(false),
  });
  const removeWorktreeConfirm = useTaskRemoveWorktreeConfirmDialog({
    task,
    enabled: open,
    run: onRemoveTaskWorktree,
  });
  const { openDialog: openResetDialog } = resetConfirm;
  const { openDialog: openCloseDialog } = closeConfirm;
  const { openDialog: openRemoveWorktreeDialog } = removeWorktreeConfirm;
  const runWorkflowAction = useCallback(
    (action: TaskWorkflowAction): void => {
      if (!runAction)
        throw new Error("Task details need the task workflow actions to run a workflow action.");
      const afterConfirm = (continuation?: TaskWorkflowContinuation) =>
        continuation
          ? (committed: WireTaskCard) => continueTaskWorkflow(committed, continuation)
          : undefined;
      runAction(task, action, {
        sessionOptionsOf: resolveSessionOptionsByRole,
        // The sheet is not modal, so its confirmations stay inside it to keep focus.
        confirm: (confirmation, continuation) =>
          confirmation === "close_task"
            ? openCloseDialog(afterConfirm(continuation))
            : openResetDialog(afterConfirm(continuation)),
        onRemoveWorktree: openRemoveWorktreeDialog,
      });
      // The session opens in place of the current view, so the sheet must not stay over it.
      if (sessionRoleForViewAction(action, task)) onOpenChange(false);
    },
    [
      runAction,
      task,
      resolveSessionOptionsByRole,
      openCloseDialog,
      openResetDialog,
      openRemoveWorktreeDialog,
      continueTaskWorkflow,
      onOpenChange,
    ],
  );

  return {
    taskId,
    deleteConfirm,
    resetConfirm,
    closeConfirm,
    removeWorktreeConfirm,
    taskLabels,
    runWorkflowAction,
  };
}
