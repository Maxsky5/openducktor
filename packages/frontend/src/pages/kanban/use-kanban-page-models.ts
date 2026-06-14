import { DEFAULT_KANBAN_SETTINGS, type TaskCard } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { GitConflict } from "@/features/agent-studio-git";
import { useGitConflictResolution } from "@/features/git-conflict-resolution";
import { errorMessage } from "@/lib/errors";
import {
  useAgentOperations,
  useAgentSessionSummaries,
  useTasksState,
  useWorkspaceState,
} from "@/state";
import { agentSessionBulkQueryOptions } from "@/state/queries/agent-sessions";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { useAgentStudioRepoSettings } from "../agents/use-agent-studio-repo-settings";
import type { KanbanPageModels } from "./kanban-page-model-types";
import { useKanbanBoardModel } from "./use-kanban-board-model";
import { useKanbanSessionStartFlow } from "./use-kanban-session-start-flow";
import { useKanbanTaskDialogs } from "./use-kanban-task-dialogs";
import { useTaskApprovalFlow } from "./use-task-approval-flow";
import { useTaskResetFlow } from "./use-task-reset-flow";

type UseKanbanPageModelsArgs = {
  onOpenDetails: (taskId: string) => void;
  onCloseDetails: () => void;
};

type ResetTaskAndReloadSessionsArgs = {
  taskId: string;
  resetTask: (taskId: string) => Promise<void>;
  removeAgentSessions: (input: { taskId: string }) => Promise<void>;
  loadAgentSessions: (taskId: string) => Promise<void>;
  onSessionRefreshError?: (error: unknown) => void;
};

const EMPTY_KANBAN_TASKS = Object.freeze([]) as unknown as TaskCard[];

export const resetTaskAndReloadSessions = async ({
  taskId,
  resetTask,
  removeAgentSessions,
  loadAgentSessions,
  onSessionRefreshError,
}: ResetTaskAndReloadSessionsArgs): Promise<void> => {
  await resetTask(taskId);
  await removeAgentSessions({ taskId });
  try {
    await loadAgentSessions(taskId);
  } catch (error: unknown) {
    onSessionRefreshError?.(error);
    throw error;
  }
};

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
  onCloseDetails,
}: UseKanbanPageModelsArgs): KanbanPageModels {
  const { activeWorkspace, branches, isSwitchingWorkspace, loadRepoSettings } = useWorkspaceState();
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { repoSettings } = useAgentStudioRepoSettings({ activeWorkspace });
  const {
    loadAgentSessions,
    removeAgentSessions,
    startAgentSession,
    settleStartedAgentSession,
    sendAgentMessage,
  } = useAgentOperations();
  const sessions = useAgentSessionSummaries();
  const {
    refreshTasks,
    syncPullRequests,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
    unlinkPullRequest,
    isForegroundLoadingTasks,
    detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId,
    pendingMergedPullRequest,
    unlinkingPullRequestTaskId,
    deleteTask,
    resetTaskImplementation,
    resetTask,
    humanApproveTask,
    humanRequestChangesTask,
    setTaskTargetBranch,
    tasks,
  } = useTasksState();
  const reportedSettingsErrorRef = useRef<string | null>(null);
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const doneVisibleDays = settingsSnapshotQuery.data?.kanban.doneVisibleDays;
  const openAgentStudioTabOnBackgroundSessionStart =
    settingsSnapshotQuery.data?.general.openAgentStudioTabOnBackgroundSessionStart ?? null;
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

  const kanbanTasks =
    workspaceRepoPath && !settingsSnapshotQuery.isError ? tasks : EMPTY_KANBAN_TASKS;
  const kanbanTaskIds = useMemo(() => kanbanTasks.map((task) => task.id), [kanbanTasks]);
  const shouldLoadHistoricalSessions = workspaceRepoPath !== null && kanbanTaskIds.length > 0;
  const historicalSessionsQuery = useQuery({
    ...agentSessionBulkQueryOptions(workspaceRepoPath ?? "", kanbanTaskIds),
    enabled: shouldLoadHistoricalSessions,
  });
  const historicalSessionsByTaskId = useMemo(
    () => new Map(Object.entries(historicalSessionsQuery.data ?? {})),
    [historicalSessionsQuery.data],
  );
  const reportedHistoricalSessionsErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!historicalSessionsQuery.isError) {
      reportedHistoricalSessionsErrorRef.current = null;
      return;
    }

    const description = errorMessage(historicalSessionsQuery.error);
    if (reportedHistoricalSessionsErrorRef.current === description) {
      return;
    }

    reportedHistoricalSessionsErrorRef.current = description;
    toast.error("Failed to load task session history", {
      description,
    });
  }, [historicalSessionsQuery.error, historicalSessionsQuery.isError]);
  const isLoadingKanbanTasks = isKanbanForegroundLoading({
    hasActiveWorkspace: workspaceRepoPath !== null,
    isForegroundLoadingTasks,
    isSettingsPending: settingsSnapshotQuery.isPending,
    doneVisibleDays,
    isKanbanPending: false,
  });
  const navigate = useNavigate();

  const sessionStartFlow = useKanbanSessionStartFlow({
    activeWorkspace,
    branches,
    repoSettings,
    openAgentStudioTabOnBackgroundSessionStart,
    tasks: kanbanTasks,
    sessions,
    navigate,
    loadRepoSettings,
    loadAgentSessions,
    humanRequestChangesTask,
    setTaskTargetBranch,
    startAgentSession,
    settleStartedAgentSession,
    sendAgentMessage,
  });
  const {
    humanReviewFeedbackModal,
    sessionStartModal,
    startSessionIntent,
    onPullRequestGenerate,
    onDelegate,
    onOpenSession,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onHumanRequestChanges,
  } = sessionStartFlow;

  const onRefreshTasks = useCallback((): void => {
    void refreshTasks();
  }, [refreshTasks]);
  const onDetectPullRequest = useCallback(
    (taskId: string): void => {
      void syncPullRequests(taskId);
    },
    [syncPullRequests],
  );
  const onUnlinkPullRequest = useCallback(
    (taskId: string): void => {
      void unlinkPullRequest(taskId);
    },
    [unlinkPullRequest],
  );
  const onResetTask = useCallback(
    async (taskId: string): Promise<void> => {
      await resetTaskAndReloadSessions({
        taskId,
        resetTask,
        removeAgentSessions,
        loadAgentSessions,
        onSessionRefreshError: (error) => {
          toast.error("Failed to refresh sessions", {
            description: errorMessage(error),
          });
        },
      });
    },
    [loadAgentSessions, removeAgentSessions, resetTask],
  );
  const { handleResolveGitConflict } = useGitConflictResolution({
    activeWorkspace,
    startConflictResolutionSession: async (request) =>
      startSessionIntent({
        taskId: request.taskId,
        role: request.role,
        launchActionId: "build_rebase_conflict_resolution",
        initialStartMode: request.initialStartMode,
        targetWorkingDirectory: request.targetWorkingDirectory,
        initialSourceSession: request.initialSourceSession,
        existingSessionOptions: request.existingSessionOptions,
        postStartAction: "send_message",
        message: request.message,
      }),
  });
  const handleResolveKanbanGitConflict = useCallback(
    (conflict: GitConflict, taskId: string) => {
      const task = kanbanTasks.find((entry) => entry.id === taskId) ?? null;
      const builderSessions = sessions.filter(
        (entry) => entry.role === "build" && entry.taskId === taskId,
      );
      return handleResolveGitConflict(conflict, {
        taskId,
        task,
        builderSessions,
        currentViewSession: null,
        onOpenSession: (session) => {
          const search = new URLSearchParams({
            task: taskId,
            session: session.externalSessionId,
            agent: "build",
          });
          navigate(`/agents?${search.toString()}`);
        },
      });
    },
    [handleResolveGitConflict, kanbanTasks, navigate, sessions],
  );
  const { resetImplementationModal, openResetImplementation } = useTaskResetFlow({
    tasks: kanbanTasks,
    sessions,
    loadAgentSessions,
    removeAgentSessions,
    resetTaskImplementation,
    closeTaskDetails: onCloseDetails,
  });

  const { taskApprovalModal, taskGitConflictDialog, openTaskApproval } = useTaskApprovalFlow({
    activeWorkspace,
    tasks: kanbanTasks,
    requestPullRequestGeneration: onPullRequestGenerate,
    refreshTasks,
    humanApproveTask,
    openResetImplementation,
    onResolveGitConflict: handleResolveKanbanGitConflict,
  });

  const onHumanApprove = useCallback(
    (taskId: string): void => {
      openTaskApproval(taskId);
    },
    [openTaskApproval],
  );

  const taskDialogs = useKanbanTaskDialogs({
    tasks: kanbanTasks,
  });

  const content = useKanbanBoardModel({
    isLoadingTasks: isLoadingKanbanTasks,
    isSwitchingWorkspace,
    emptyColumnDisplay,
    tasks: kanbanTasks,
    historicalSessionsByTaskId,
    sessions,
    onOpenDetails,
    onDelegate,
    onOpenSession,
    onPlan,
    onQaStart,
    onQaOpen,
    onBuild,
    onHumanApprove,
    onHumanRequestChanges,
    onResetImplementation: openResetImplementation,
  });

  return {
    header: {
      isLoadingTasks: isLoadingKanbanTasks,
      isSwitchingWorkspace,
      onCreateTask: taskDialogs.onCreateTask,
      onRefreshTasks,
    },
    content,
    taskComposer: taskDialogs.taskComposer,
    taskDetailsController: {
      activeWorkspace,
      allTasks: kanbanTasks,
      taskSessionsByTaskId: content.taskSessionsByTaskId,
      historicalSessionsByTaskId: content.historicalSessionsByTaskId,
      activeTaskSessionContextByTaskId: content.activeTaskSessionContextByTaskId,
      onOpenSession,
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onDelegate,
      onEdit: taskDialogs.onEditTask,
      onHumanApprove,
      onHumanRequestChanges,
      onResetImplementation: openResetImplementation,
      onResetTask,
      onDetectPullRequest,
      onUnlinkPullRequest,
      detectingPullRequestTaskId,
      unlinkingPullRequestTaskId,
      onDelete: (taskId, options) => deleteTask(taskId, options.deleteSubtasks),
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
    humanReviewFeedbackModal,
    taskApprovalModal,
    resetImplementationModal,
    taskGitConflictDialog,
    sessionStartModal,
  };
}
