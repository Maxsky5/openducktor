import { DEFAULT_KANBAN_SETTINGS, type TaskCard } from "@openducktor/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { GitConflict } from "@/features/agent-studio-git";
import { useGitConflictResolution } from "@/features/git-conflict-resolution";
import { useSessionStartWorkflowRunner } from "@/features/session-start";
import { errorMessage } from "@/lib/errors";
import {
  useAgentOperations,
  useAgentSessionSummaries,
  useTasksState,
  useWorkspaceState,
} from "@/state";
import { useAgentSessionLists } from "@/state/queries/use-agent-session-lists";
import { useHorizontalScrollbarVisibility } from "@/state/queries/use-horizontal-scrollbar-visibility";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { buildAgentStudioHref } from "../agents/query-sync/agent-studio-navigation";
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

const EMPTY_KANBAN_TASKS = Object.freeze([]) as unknown as TaskCard[];

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
  onCloseDetails,
}: UseKanbanPageModelsArgs): KanbanPageModels {
  const { activeWorkspace, branches, isSwitchingWorkspace } = useWorkspaceState();
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;
  const { repoSettings } = useAgentStudioRepoSettings({ activeWorkspaceId });
  const { startAgentSession, sendAgentMessage } = useAgentOperations();
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
    closeTask,
    resetTaskImplementation,
    resetTask,
    humanApproveTask,
    humanRequestChangesTask,
    setTaskTargetBranch,
    tasks,
  } = useTasksState();
  const reportedSettingsErrorRef = useRef<string | null>(null);
  const reportedPlatformErrorRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const doneVisibleDays = settingsSnapshotQuery.data?.kanban.doneVisibleDays;
  const horizontalScrollbarVisibility =
    settingsSnapshotQuery.data?.appearance.horizontalScrollbarVisibility;
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
  const navigate = useNavigate();
  const runSessionStartWorkflow = useSessionStartWorkflowRunner({
    workspaceId: activeWorkspaceId,
    startAgentSession,
    sendAgentMessage,
  });

  const sessionStartFlow = useKanbanSessionStartFlow({
    activeWorkspaceId,
    branches,
    repoSettings,
    openAgentStudioTabOnBackgroundSessionStart,
    tasks: kanbanTasks,
    sessions,
    navigate,
    workspaceRepoPath,
    humanRequestChangesTask,
    setTaskTargetBranch,
    runSessionStartWorkflow,
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
      await resetTask(taskId);
    },
    [resetTask],
  );
  const { handleResolveGitConflict } = useGitConflictResolution({
    workspaceId: activeWorkspaceId,
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
          navigate(
            buildAgentStudioHref({
              taskId,
              sessionExternalId: session.externalSessionId,
              role: "build",
            }),
          );
        },
      });
    },
    [handleResolveGitConflict, kanbanTasks, navigate, sessions],
  );
  const { resetImplementationModal, openResetImplementation } = useTaskResetFlow({
    tasks: kanbanTasks,
    sessions,
    taskWorktreeBasePath: activeWorkspace?.effectiveWorktreeBasePath ?? null,
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
    showHorizontalScrollbars: horizontalScrollbarState.showHorizontalScrollbars,
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
      onCloseTask: closeTask,
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
