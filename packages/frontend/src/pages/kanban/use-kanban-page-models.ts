import { DEFAULT_KANBAN_SETTINGS } from "@openducktor/contracts";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { TaskWorkflowActions } from "@openducktor/frontend-core/tasks/workflow/task-workflow-actions-context";
import { TASK_SESSION_HISTORY_ERROR_TOAST_ID } from "@/features/task-workflow/use-task-details-historical-sessions";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useTasksState, useWorkspaceState } from "@/state";
import { useKanbanTaskCardView } from "@/state/mutations/use-kanban-task-card-view";
import { showsHorizontalScrollbars } from "@/lib/horizontal-scrollbars";
import { useMergedTaskTargets } from "@openducktor/frontend-core/tasks/board/use-merged-task-targets";
import type { KanbanPageModels } from "./kanban-page-model-types";
import { useKanbanBoardData } from "@openducktor/frontend-core/tasks/board/use-kanban-board-data";
import { useKanbanBoardModel } from "./use-kanban-board-model";
import type { CloseTaskOptions } from "@openducktor/frontend-core/types/task-close";

type UseKanbanPageModelsArgs = {
  onOpenDetails: (taskId: string) => void;
  actions: TaskWorkflowActions;
};

export function useKanbanPageModels({
  onOpenDetails,
  actions,
}: UseKanbanPageModelsArgs): KanbanPageModels {
  const { activeWorkspace, isSwitchingWorkspace } = useWorkspaceState();
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const {
    refreshTasks,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
    linkingMergedPullRequestTaskId,
    pendingMergedPullRequest,
  } = useTasksState();
  const reportedSettingsErrorRef = useRef<string | null>(null);
  const board = useKanbanBoardData({
    workspaceId: activeWorkspaceId,
    repoPath: workspaceRepoPath,
  });
  const { settingsQuery: settingsSnapshotQuery, filter } = board;
  const taskCardViewState = useKanbanTaskCardView();
  const horizontalScrollbarVisibility =
    settingsSnapshotQuery.data?.appearance.horizontalScrollbarVisibility;
  useEffect(() => {
    if (!settingsSnapshotQuery.isError) {
      reportedSettingsErrorRef.current = null;
      return;
    }

    const description = errorMessage(settingsSnapshotQuery.error);
    if (reportedSettingsErrorRef.current === description) {
      return;
    }

    reportedSettingsErrorRef.current = description;
    toast.error("Failed to load Kanban settings", {
      description,
    });
  }, [settingsSnapshotQuery.error, settingsSnapshotQuery.isError]);
  const showHorizontalScrollbars =
    workspaceRepoPath !== null && !settingsSnapshotQuery.isPending && !settingsSnapshotQuery.isError
      ? showsHorizontalScrollbars(horizontalScrollbarVisibility)
      : null;

  const historicalSessionsError = board.historicalSessionsError ?? undefined;
  const reportedHistoricalSessionsErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!historicalSessionsError) {
      reportedHistoricalSessionsErrorRef.current = null;
      return;
    }

    const description = errorMessage(historicalSessionsError);
    if (reportedHistoricalSessionsErrorRef.current === description) {
      return;
    }

    reportedHistoricalSessionsErrorRef.current = description;
    toast.error("Failed to load task session history", {
      id: TASK_SESSION_HISTORY_ERROR_TOAST_ID,
      description,
    });
  }, [historicalSessionsError]);
  const isLoadingKanbanTasks = board.isLoadingTasks;

  const onRefreshTasks = useCallback((): void => {
    void refreshTasks();
  }, [refreshTasks]);
  const mergedTargetByTaskId = useMergedTaskTargets(workspaceRepoPath, board.kanbanTasks);
  const { onConfirmTaskAction } = actions;
  const onCloseTask = useCallback(
    (taskId: string): void => onConfirmTaskAction(taskId, "close"),
    [onConfirmTaskAction],
  );

  const content = useKanbanBoardModel({
    isLoadingTasks: isLoadingKanbanTasks,
    isSwitchingWorkspace,
    emptyColumnDisplay: board.emptyColumnDisplay,
    taskCardView: taskCardViewState.taskCardView ?? DEFAULT_KANBAN_SETTINGS.taskCardView,
    showHorizontalScrollbars,
    tasks: board.matchingTasks,
    hasLoadedTasks: board.kanbanTasks.length > 0,
    filter,
    historicalSessionsByTaskId: board.historicalSessionsByTaskId,
    mergedTargetByTaskId,
    pendingState: actions.kanbanPendingState,
    taskSessionsByTaskId: actions.taskSessionsByTaskId,
    activeTaskSessionContextByTaskId: actions.activeTaskSessionContextByTaskId,
    onOpenDetails,
    onDelegate: actions.onDelegate,
    onOpenSession: actions.onOpenSession,
    onPlan: actions.onPlan,
    onQaStart: actions.onQaStart,
    onHumanApprove: actions.onHumanApprove,
    onHumanRequestChanges: actions.onHumanRequestChanges,
    onResetImplementation: actions.onResetImplementation,
    onCloseTask,
  });
  return {
    header: {
      isLoadingTasks: isLoadingKanbanTasks,
      isSwitchingWorkspace,
      taskCardView: taskCardViewState.taskCardView,
      isTaskCardViewPending: taskCardViewState.isPending,
      onTaskCardViewChange: taskCardViewState.changeTaskCardView,
      onRefreshTasks,
      filter,
    },
    content,
    activeWorkspace,
    mergedPullRequestModal: pendingMergedPullRequest
      ? {
          ...pendingMergedPullRequest,
          isLinking: pendingMergedPullRequest.taskId === linkingMergedPullRequestTaskId,
          onCancel: cancelLinkMergedPullRequest,
          onConfirm: (options: CloseTaskOptions) => {
            void linkMergedPullRequest(options);
          },
        }
      : null,
  };
}
