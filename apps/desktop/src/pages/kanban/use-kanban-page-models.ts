import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
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
import { kanbanTaskListQueryOptions } from "@/state/queries/tasks";
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

export const isKanbanForegroundLoading = (args: {
  hasActiveRepo: boolean;
  isForegroundLoadingTasks: boolean;
  isSettingsPending: boolean;
  doneVisibleDays: number | undefined;
  isKanbanPending: boolean;
}): boolean => {
  if (args.isForegroundLoadingTasks || !args.hasActiveRepo || args.isSettingsPending) {
    return args.isForegroundLoadingTasks || (args.hasActiveRepo && args.isSettingsPending);
  }

  return args.doneVisibleDays !== undefined && args.isKanbanPending;
};

export function useKanbanPageModels({
  onOpenDetails,
  onCloseDetails,
}: UseKanbanPageModelsArgs): KanbanPageModels {
  const { activeRepo, branches, isSwitchingWorkspace, loadRepoSettings } = useWorkspaceState();
  const { repoSettings } = useAgentStudioRepoSettings({ activeRepo });
  const {
    bootstrapTaskSessions,
    hydrateRequestedTaskSessionHistory,
    loadAgentSessions,
    removeAgentSessions,
    startAgentSession,
    sendAgentMessage,
  } = useAgentOperations();
  const sessions = useAgentSessionSummaries();
  const {
    runs,
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
    deferTask,
    resumeDeferredTask,
    humanApproveTask,
    humanRequestChangesTask,
    setTaskTargetBranch,
  } = useTasksState();
  const reportedSettingsErrorRef = useRef<string | null>(null);
  const reportedKanbanTasksErrorRef = useRef<string | null>(null);
  const settingsSnapshotQuery = useQuery(settingsSnapshotQueryOptions());
  const doneVisibleDays = settingsSnapshotQuery.data?.kanban.doneVisibleDays;
  const kanbanTaskListQuery = useQuery({
    ...kanbanTaskListQueryOptions(activeRepo ?? "__disabled__", doneVisibleDays ?? 0),
    enabled: activeRepo !== null && doneVisibleDays !== undefined,
  });
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
    if (!kanbanTaskListQuery.isError) {
      reportedKanbanTasksErrorRef.current = null;
      return;
    }

    const description = errorMessage(kanbanTaskListQuery.error);
    if (reportedKanbanTasksErrorRef.current === description) {
      return;
    }

    reportedKanbanTasksErrorRef.current = description;
    toast.error("Failed to load Kanban tasks", {
      description,
    });
  }, [kanbanTaskListQuery.error, kanbanTaskListQuery.isError]);

  const kanbanTasks = activeRepo ? (kanbanTaskListQuery.data ?? []) : [];
  const isLoadingKanbanTasks = isKanbanForegroundLoading({
    hasActiveRepo: activeRepo !== null,
    isForegroundLoadingTasks,
    isSettingsPending: settingsSnapshotQuery.isPending,
    doneVisibleDays,
    isKanbanPending: kanbanTaskListQuery.isPending,
  });
  const navigate = useNavigate();

  const sessionStartFlow = useKanbanSessionStartFlow({
    activeRepo,
    branches,
    repoSettings,
    tasks: kanbanTasks,
    sessions,
    navigate,
    loadRepoSettings,
    bootstrapTaskSessions,
    hydrateRequestedTaskSessionHistory,
    loadAgentSessions,
    humanRequestChangesTask,
    setTaskTargetBranch,
    startAgentSession,
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
      await resetTask(taskId);
      removeAgentSessions({
        taskId,
        roles: ["spec", "planner", "build", "qa"],
      });
      try {
        await loadAgentSessions(taskId);
      } catch (error: unknown) {
        toast.error("Failed to refresh sessions", {
          description: errorMessage(error),
        });
        throw error;
      }
    },
    [loadAgentSessions, removeAgentSessions, resetTask],
  );
  const { handleResolveGitConflict } = useGitConflictResolution({
    activeRepo,
    startConflictResolutionSession: async (request) =>
      startSessionIntent({
        taskId: request.taskId,
        role: request.role,
        scenario: request.scenario,
        initialStartMode: request.initialStartMode,
        targetWorkingDirectory: request.targetWorkingDirectory,
        sourceSessionId: request.initialSourceSessionId,
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
        currentViewSessionId: null,
        onOpenSession: (sessionId) => {
          const search = new URLSearchParams({
            task: taskId,
            session: sessionId,
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
    activeRepo,
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
    tasks: kanbanTasks,
    runs,
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
      activeRepo,
      allTasks: kanbanTasks,
      runs,
      taskSessionsByTaskId: content.taskSessionsByTaskId,
      activeTaskSessionContextByTaskId: content.activeTaskSessionContextByTaskId,
      onOpenSession,
      onPlan,
      onQaStart,
      onQaOpen,
      onBuild,
      onDelegate,
      onEdit: taskDialogs.onEditTask,
      onDefer: (taskId) => {
        void deferTask(taskId);
      },
      onResumeDeferred: (taskId) => {
        void resumeDeferredTask(taskId);
      },
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
