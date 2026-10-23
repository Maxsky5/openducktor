import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useCallback, useMemo } from "react";
import {
  SESSION_VIEW_ACTIONS,
  type TaskWorkflowAction,
} from "@/components/features/kanban/kanban-task-workflow";
import type { SessionTargetOptions } from "@/components/features/kanban/session-target-resolution";
import {
  toSubtasks,
  toTaskLabels,
} from "@/components/features/task-details/task-details-sheet-model";
import type { TaskDetailsSheetProps } from "@/components/features/task-details/task-details-sheet-types";
import { useTaskCleanupImpact } from "@/components/features/task-details/use-task-cleanup-impact";
import {
  type TaskConfirmDialog,
  useTaskConfirmDialog,
} from "@/components/features/task-details/use-task-confirm-dialog";
import { runTaskWorkflowAction } from "@/features/task-workflow/run-task-workflow-action";
import type { TaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { useTaskStopImpact } from "@/state/queries/use-task-stop-impact";
import type { ActiveWorkspace } from "@/types/state-slices";

type TaskDetailsSheetViewModel = {
  taskId: string | null;
  deleteConfirm: TaskConfirmDialog;
  resetConfirm: TaskConfirmDialog;
  closeConfirm: TaskConfirmDialog;
  subtasks: TaskCard[];
  shouldRenderSubtasks: boolean;
  taskLabels: string[];
  runWorkflowAction: (action: TaskWorkflowAction) => void;
};

type UseTaskDetailsSheetViewModelOptions = {
  activeWorkspace?: ActiveWorkspace | null;
  task: TaskDetailsSheetProps["task"];
  allTasks: TaskDetailsSheetProps["allTasks"];
  open: TaskDetailsSheetProps["open"];
  onOpenChange: TaskDetailsSheetProps["onOpenChange"];
  onPlan?: TaskWorkflowActions["onPlan"] | undefined;
  onQaStart?: TaskWorkflowActions["onQaStart"] | undefined;
  onQaOpen?: TaskWorkflowActions["onQaOpen"] | undefined;
  onBuild?: TaskWorkflowActions["onBuild"] | undefined;
  onOpenSession?: TaskWorkflowActions["onOpenSession"] | undefined;
  resolveSessionOptionsByRole?: ((role: AgentRole) => SessionTargetOptions | undefined) | undefined;
  onDelegate?: TaskWorkflowActions["onDelegate"] | undefined;
  onHumanApprove?: TaskWorkflowActions["onHumanApprove"] | undefined;
  onHumanRequestChanges?: TaskWorkflowActions["onHumanRequestChanges"] | undefined;
  onResetImplementation?: TaskWorkflowActions["onResetImplementation"] | undefined;
  onResetTask?: TaskWorkflowActions["onResetTask"] | undefined;
  onCloseTask?: TaskWorkflowActions["onCloseTask"] | undefined;
  onDelete?: TaskWorkflowActions["onDelete"] | undefined;
  taskCleanupImpactHook?: typeof useTaskCleanupImpact;
  taskStopImpactHook?: typeof useTaskStopImpact;
};

export function useTaskDetailsSheetViewModel({
  task,
  allTasks,
  open,
  onOpenChange,
  onPlan,
  onQaStart,
  onQaOpen,
  onBuild,
  onOpenSession,
  resolveSessionOptionsByRole,
  onDelegate,
  onHumanApprove,
  onHumanRequestChanges,
  onResetImplementation,
  onResetTask,
  onCloseTask,
  onDelete,
  taskCleanupImpactHook = useTaskCleanupImpact,
  taskStopImpactHook = useTaskStopImpact,
}: UseTaskDetailsSheetViewModelOptions): TaskDetailsSheetViewModel {
  const taskId = task?.id ?? null;
  const taskById = useMemo(() => new Map(allTasks.map((entry) => [entry.id, entry])), [allTasks]);
  const subtasks = useMemo(() => toSubtasks(task, taskById), [task, taskById]);
  const shouldRenderSubtasks = task?.issueType === "epic";
  const taskLabels = useMemo(() => toTaskLabels(task?.labels), [task?.labels]);

  const confirmOptions = {
    task,
    allTasks,
    enabled: open,
    onSucceeded: () => onOpenChange(false),
    taskCleanupImpactHook,
    taskStopImpactHook,
  };
  const deleteConfirm = useTaskConfirmDialog({
    ...confirmOptions,
    action: "delete",
    run: onDelete && ((id) => onDelete(id, { deleteSubtasks: true })),
  });
  const resetConfirm = useTaskConfirmDialog({
    ...confirmOptions,
    action: "reset_task",
    run: onResetTask,
  });
  const closeConfirm = useTaskConfirmDialog({
    ...confirmOptions,
    action: "close",
    run: onCloseTask,
  });
  const { openDialog: openResetDialog } = resetConfirm;
  const { openDialog: openCloseDialog } = closeConfirm;
  const runWorkflowAction = useCallback(
    (action: TaskWorkflowAction): void => {
      runTaskWorkflowAction(
        action,
        taskId,
        {
          onPlan,
          onQaStart,
          onQaOpen,
          onBuild,
          onOpenSession,
          onDelegate,
          onHumanApprove,
          onHumanRequestChanges,
          onResetImplementation,
          onResetTask: openResetDialog,
          onCloseTask: openCloseDialog,
        },
        {
          resolveSessionOptions: resolveSessionOptionsByRole,
        },
      );
      // The session opens in place of the current view, so the sheet must not stay over it.
      if (SESSION_VIEW_ACTIONS.has(action)) onOpenChange(false);
    },
    [
      onOpenChange,
      onBuild,
      onDelegate,
      onOpenSession,
      resolveSessionOptionsByRole,
      onHumanApprove,
      onHumanRequestChanges,
      onPlan,
      onQaOpen,
      onQaStart,
      onResetImplementation,
      openResetDialog,
      openCloseDialog,
      taskId,
    ],
  );

  return {
    taskId,
    deleteConfirm,
    resetConfirm,
    closeConfirm,
    subtasks,
    shouldRenderSubtasks,
    taskLabels,
    runWorkflowAction,
  };
}
