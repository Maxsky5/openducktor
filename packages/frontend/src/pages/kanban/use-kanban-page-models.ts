import { DEFAULT_KANBAN_SETTINGS, type TaskCard } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import type { TaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { TASK_SESSION_HISTORY_ERROR_TOAST_ID } from "@/features/task-workflow/use-task-details-historical-sessions";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useTasksState, useWorkspaceState } from "@/state";
import { useAgentSessionLists } from "@openducktor/frontend-core/queries/use-agent-session-lists";
import { useKanbanTaskCardView } from "@/state/mutations/use-kanban-task-card-view";
import { showsHorizontalScrollbars } from "@/lib/horizontal-scrollbars";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import type { KanbanPageModels } from "./kanban-page-model-types";
import { useKanbanBoardFilterModel } from "./use-kanban-board-filter-model";
import { useKanbanBoardModel } from "./use-kanban-board-model";

type UseKanbanPageModelsArgs = {
  onOpenDetails: (taskId: string) => void;
  actions: TaskWorkflowActions;
};

const EMPTY_KANBAN_TASKS: TaskCard[] = [];

export const isKanbanForegroundLoading = (args: {
  hasActiveWorkspace: boolean;
  isForegroundLoadingTasks: boolean;
  isSettingsPending: boolean;
  doneVisibleDays: number | undefined;
  isKanbanPending: boolean;
}): boolean => {
  if (args.isForegroundLoadingTasks || !args.hasActiveWorkspace || args.isSettingsPending) {
    return args.isForegroundLoadingTasks || (args.hasActiveWorkspace && args.isSettingsPending);
  }

  return args.doneVisibleDays !== undefined && args.isKanbanPending;
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
    isForegroundLoadingTasks,
    linkingMergedPullRequestTaskId,
    pendingMergedPullRequest,
    tasks,
  } = useTasksState();
  const reportedSettingsErrorRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const taskCardViewState = useKanbanTaskCardView();
  const doneVisibleDays = settingsSnapshotQuery.data?.kanban.doneVisibleDays;
  const horizontalScrollbarVisibility =
    settingsSnapshotQuery.data?.appearance.horizontalScrollbarVisibility;
  const emptyColumnDisplay =
    settingsSnapshotQuery.data?.kanban.emptyColumnDisplay ??
    DEFAULT_KANBAN_SETTINGS.emptyColumnDisplay;
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

  const kanbanTasks =
    workspaceRepoPath && !settingsSnapshotQuery.isError ? tasks : EMPTY_KANBAN_TASKS;
  const kanbanTaskIds = useMemo(() => kanbanTasks.map((task) => task.id), [kanbanTasks]);
  const { filter, matchingTasks } = useKanbanBoardFilterModel(activeWorkspaceId, kanbanTasks);
  const shouldLoadHistoricalSessions = workspaceRepoPath !== null && kanbanTaskIds.length > 0;
  const historicalSessionLists = useAgentSessionLists({
    repoPath: workspaceRepoPath,
    taskIds: kanbanTaskIds,
    enabled: shouldLoadHistoricalSessions,
    queryClient,
  });
  const historicalSessionsByTaskId = useMemo(
    () =>
      new Map(kanbanTaskIds.map((taskId) => [taskId, historicalSessionLists.data[taskId] ?? []])),
    [historicalSessionLists.data, kanbanTaskIds],
  );
  const historicalSessionsError = historicalSessionLists.error ?? undefined;
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
  const isLoadingKanbanTasks = isKanbanForegroundLoading({
    hasActiveWorkspace: workspaceRepoPath !== null,
    isForegroundLoadingTasks,
    isSettingsPending: settingsSnapshotQuery.isPending,
    doneVisibleDays,
    isKanbanPending: false,
  });

  const onRefreshTasks = useCallback((): void => {
    void refreshTasks();
  }, [refreshTasks]);

  const content = useKanbanBoardModel({
    isLoadingTasks: isLoadingKanbanTasks,
    isSwitchingWorkspace,
    emptyColumnDisplay,
    taskCardView: taskCardViewState.taskCardView ?? DEFAULT_KANBAN_SETTINGS.taskCardView,
    showHorizontalScrollbars,
    tasks: matchingTasks,
    hasLoadedTasks: kanbanTasks.length > 0,
    filter,
    historicalSessionsByTaskId,
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
          onConfirm: () => {
            void linkMergedPullRequest();
          },
        }
      : null,
  };
}
