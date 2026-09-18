import { DEFAULT_KANBAN_SETTINGS, type TaskCard } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import type { TaskWorkflowActions } from "@/features/task-workflow/task-workflow-actions-context";
import { TASK_SESSION_HISTORY_ERROR_TOAST_ID } from "@/features/task-workflow/use-task-details-historical-sessions";
import { errorMessage } from "@/lib/errors";
import { gitProviderReadError } from "@/lib/git-provider-health";
import { useTasksState, useWorkspaceState } from "@/state";
import { useAgentSessionLists } from "@/state/queries/use-agent-session-lists";
import { useHorizontalScrollbarVisibility } from "@/state/queries/use-horizontal-scrollbar-visibility";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { useAgentStudioRepoSettings } from "../agents/use-agent-studio-repo-settings";
import type { KanbanPageModels } from "./kanban-page-model-types";
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
  isScrollbarPlatformUnresolved: boolean;
  doneVisibleDays: number | undefined;
  isKanbanPending: boolean;
}): boolean => {
  if (
    args.isForegroundLoadingTasks ||
    !args.hasActiveWorkspace ||
    args.isSettingsPending ||
    args.isScrollbarPlatformUnresolved
  ) {
    return (
      args.isForegroundLoadingTasks ||
      (args.hasActiveWorkspace && (args.isSettingsPending || args.isScrollbarPlatformUnresolved))
    );
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
  const { gitProvider } = useAgentStudioRepoSettings({
    activeRepoPath: workspaceRepoPath,
    activeWorkspaceId,
  });
  const providerReadError = gitProviderReadError(gitProvider.error);
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
  const reportedPlatformErrorRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
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
  useEffect(() => {
    if (!gitProvider.error) {
      return;
    }

    toast.error("Failed to load Git provider context", {
      description: providerReadError,
      action: {
        label: "Retry",
        onClick: gitProvider.retry,
      },
    });
  }, [gitProvider.error, gitProvider.retry, providerReadError]);
  const canResolveHorizontalScrollbarVisibility =
    workspaceRepoPath !== null &&
    !settingsSnapshotQuery.isPending &&
    !settingsSnapshotQuery.isError;
  const horizontalScrollbarState = useHorizontalScrollbarVisibility({
    enabled: canResolveHorizontalScrollbarVisibility,
    visibility: horizontalScrollbarVisibility,
  });
  useEffect(() => {
    const platformError = horizontalScrollbarState.platformError;
    if (!platformError) {
      reportedPlatformErrorRef.current = null;
      return;
    }

    const description = errorMessage(platformError);
    if (reportedPlatformErrorRef.current === description) {
      return;
    }

    reportedPlatformErrorRef.current = description;
    toast.error("Failed to resolve horizontal scrollbar default", {
      description,
    });
  }, [horizontalScrollbarState.platformError]);

  const kanbanTasks =
    workspaceRepoPath && !settingsSnapshotQuery.isError ? tasks : EMPTY_KANBAN_TASKS;
  const kanbanTaskIds = useMemo(() => kanbanTasks.map((task) => task.id), [kanbanTasks]);
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
    isScrollbarPlatformUnresolved: horizontalScrollbarState.isResolvingPlatformDefault,
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
    showHorizontalScrollbars: horizontalScrollbarState.showHorizontalScrollbars,
    tasks: kanbanTasks,
    historicalSessionsByTaskId,
    taskSessionsByTaskId: actions.taskSessionsByTaskId,
    activeTaskSessionContextByTaskId: actions.activeTaskSessionContextByTaskId,
    onOpenDetails,
    onDelegate: actions.onDelegate,
    onOpenSession: actions.onOpenSession,
    onPlan: actions.onPlan,
    onQaStart: actions.onQaStart,
    onQaOpen: actions.onQaOpen,
    onBuild: actions.onBuild,
    onHumanApprove: actions.onHumanApprove,
    onHumanRequestChanges: actions.onHumanRequestChanges,
    onResetImplementation: actions.onResetImplementation,
  });

  return {
    header: {
      isLoadingTasks: isLoadingKanbanTasks,
      isSwitchingWorkspace,
      onCreateTask: actions.onCreateTask,
      onRefreshTasks,
    },
    content,
    taskDetailsController: {
      activeWorkspace,
      allTasks: kanbanTasks,
    },
    mergedPullRequestModal: pendingMergedPullRequest
      ? {
          pullRequest: pendingMergedPullRequest.pullRequest,
          isLinking: pendingMergedPullRequest.taskId === linkingMergedPullRequestTaskId,
          onCancel: cancelLinkMergedPullRequest,
          onConfirm: () => {
            void linkMergedPullRequest();
          },
        }
      : null,
  };
}
