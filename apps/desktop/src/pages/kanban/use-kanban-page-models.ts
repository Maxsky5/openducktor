import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
  const {
    sessions,
    loadAgentSessions,
    removeAgentSessions,
    startAgentSession,
    forkAgentSession,
    sendAgentMessage,
    updateAgentSessionModel,
  } = useAgentState();
  const {
    tasks,
    runs,
    refreshTasks,
    syncPullRequests,
    unlinkPullRequest,
    isLoadingTasks,
    detectingPullRequestTaskId,
    unlinkingPullRequestTaskId,
    deleteTask,
    resetTaskImplementation,
    deferTask,
    resumeDeferredTask,
    humanRequestChangesTask,
  } = useTasksState();
  const navigate = useNavigate();

  const { repoSettings } = useAgentStudioRepoSettings({ activeRepo });

  const sessionStartFlow = useKanbanSessionStartFlow({
    activeRepo,
    repoSettings,
    tasks,
    sessions,
    navigate,
    loadRepoSettings,
    loadAgentSessions,
    humanRequestChangesTask,
    startAgentSession,
    sendAgentMessage,
    updateAgentSessionModel,
  });
  const {
    humanReviewFeedbackModal,
    sessionStartModal,
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
  const { taskApprovalModal, openTaskApproval } = useTaskApprovalFlow({
    activeRepo,
    tasks,
    sessions,
    loadAgentSessions,
    forkAgentSession,
    sendAgentMessage,
    refreshTasks,
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
    humanReviewFeedbackModal,
    taskApprovalModal,
    resetImplementationModal,
    sessionStartModal,
  };
}
