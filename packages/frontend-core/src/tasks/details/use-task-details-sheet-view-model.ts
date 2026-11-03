import { useTaskWorkflowContinuation } from "../workflow/task-workflow-continuation";
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
import { runTaskWorkflowAction } from "../workflow/run-task-workflow-action";
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
  onLaunch?: TaskWorkflowActions["onLaunch"] | undefined;
  onApplyEvent?: TaskWorkflowActions["onApplyEvent"] | undefined;
  onOpenSession?: TaskWorkflowActions["onOpenSession"] | undefined;
  resolveSessionOptionsByRole?: ((role: AgentRole) => SessionTargetOptions | undefined) | undefined;
  onHumanApprove?: TaskWorkflowActions["onHumanApprove"] | undefined;
  onHumanRequestChanges?: TaskWorkflowActions["onHumanRequestChanges"] | undefined;
  onResetImplementation?: TaskWorkflowActions["onResetImplementation"] | undefined;
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
  onLaunch,
  onApplyEvent,
  onOpenSession,
  resolveSessionOptionsByRole,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
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
      runTaskWorkflowAction(
        action,
        taskId,
        {
          onLaunch,
          onApplyEvent,
          onOpenSession,
          onHumanApprove,
          onHumanRequestChanges,
          onResetImplementation,
          onResetTask: (_id, continuation) =>
            openResetDialog(
              continuation ? () => continueTaskWorkflow(task.id, continuation) : undefined,
            ),
          onCloseTask: (_id, continuation) =>
            openCloseDialog(
              continuation ? () => continueTaskWorkflow(task.id, continuation) : undefined,
            ),
          onRemoveTaskWorktree: openRemoveWorktreeDialog,
        },
        {
          task,
          resolveSessionOptions: resolveSessionOptionsByRole,
        },
      );
      // The session opens in place of the current view, so the sheet must not stay over it.
      if (sessionRoleForViewAction(action, task)) onOpenChange(false);
    },
    [
      onOpenChange,
      onOpenSession,
      resolveSessionOptionsByRole,
      onHumanApprove,
      onHumanRequestChanges,
      onLaunch,
      onApplyEvent,
      task,
      onResetImplementation,
      openResetDialog,
      openCloseDialog,
      openRemoveWorktreeDialog,
      taskId,
      continueTaskWorkflow,
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
