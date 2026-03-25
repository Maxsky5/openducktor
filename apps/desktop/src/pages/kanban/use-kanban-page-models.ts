import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { GitConflict } from "@/features/agent-studio-git";
import { useGitConflictResolution } from "@/features/git-conflict-resolution";
import { useAgentState, useTasksState, useWorkspaceState } from "@/state";
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

export function useKanbanPageModels({
  onOpenDetails,
  onCloseDetails,
}: UseKanbanPageModelsArgs): KanbanPageModels {
  const { activeRepo, isSwitchingWorkspace, loadRepoSettings } = useWorkspaceState();
  const { repoSettings } = useAgentStudioRepoSettings({ activeRepo });
  const {
    sessions,
    bootstrapTaskSessions,
    hydrateRequestedTaskSessionHistory,
    loadAgentSessions,
    removeAgentSessions,
    startAgentSession,
    sendAgentMessage,
  } = useAgentState();
  const {
    tasks,
    runs,
    refreshTasks,
    syncPullRequests,
    linkMergedPullRequest,
    cancelLinkMergedPullRequest,
    unlinkPullRequest,
    isLoadingTasks,
    detectingPullRequestTaskId,
    linkingMergedPullRequestTaskId,
    pendingMergedPullRequest,
    unlinkingPullRequestTaskId,
    deleteTask,
    resetTaskImplementation,
    deferTask,
    resumeDeferredTask,
    humanRequestChangesTask,
  } = useTasksState();
  const navigate = useNavigate();

  const sessionStartFlow = useKanbanSessionStartFlow({
    activeRepo,
    repoSettings,
    tasks,
    sessions,
    navigate,
    loadRepoSettings,
    bootstrapTaskSessions,
    hydrateRequestedTaskSessionHistory,
    loadAgentSessions,
    humanRequestChangesTask,
    startAgentSession,
    sendAgentMessage,
  });
  const {
    humanReviewFeedbackModal,
    sessionStartModal,
    startSessionIntent,
    onPullRequestGenerate,
    onDelegate,
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
  const { handleResolveGitConflict } = useGitConflictResolution({
    activeRepo,
    startConflictResolutionSession: async (request) =>
      startSessionIntent({
        taskId: request.taskId,
        role: request.role,
        scenario: request.scenario,
        initialStartMode: request.initialStartMode,
        sourceSessionId: request.initialSourceSessionId,
        existingSessionOptions: request.existingSessionOptions,
        postStartAction: "send_message",
        message: request.message,
      }),
  });
  const handleResolveKanbanGitConflict = useCallback(
    (conflict: GitConflict, taskId: string) => {
      const task = tasks.find((entry) => entry.id === taskId) ?? null;
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
    [handleResolveGitConflict, navigate, sessions, tasks],
  );
  const { taskApprovalModal, taskGitConflictDialog, openTaskApproval } = useTaskApprovalFlow({
    activeRepo,
    tasks,
    requestPullRequestGeneration: onPullRequestGenerate,
    refreshTasks,
    onResolveGitConflict: handleResolveKanbanGitConflict,
  });

  const onHumanApprove = useCallback(
    (taskId: string): void => {
      openTaskApproval(taskId);
    },
    [openTaskApproval],
  );

  const { resetImplementationModal, openResetImplementation } = useTaskResetFlow({
    tasks,
    sessions,
    loadAgentSessions,
    removeAgentSessions,
    resetTaskImplementation,
    closeTaskDetails: onCloseDetails,
  });

  const taskDialogs = useKanbanTaskDialogs({
    tasks,
  });

  const content = useKanbanBoardModel({
    isLoadingTasks,
    isSwitchingWorkspace,
    tasks,
    runs,
    sessions,
    onOpenDetails,
    onDelegate,
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
      isLoadingTasks,
      isSwitchingWorkspace,
      onCreateTask: taskDialogs.onCreateTask,
      onRefreshTasks,
    },
    content,
    taskComposer: taskDialogs.taskComposer,
    taskDetailsController: {
      allTasks: tasks,
      runs,
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
