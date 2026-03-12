import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentState, useTasksState, useWorkspaceState } from "@/state";
import { useAgentStudioRepoSettings } from "../agents/use-agent-studio-repo-settings";
import type { KanbanPageModels } from "./kanban-page-model-types";
import { useKanbanBoardModel } from "./use-kanban-board-model";
import { useKanbanSessionStartFlow } from "./use-kanban-session-start-flow";
import { useTaskApprovalFlow } from "./use-task-approval-flow";
import { useKanbanTaskDialogs } from "./use-kanban-task-dialogs";

type UseKanbanPageModelsArgs = {
  onOpenDetails: (taskId: string) => void;
};

export function useKanbanPageModels({ onOpenDetails }: UseKanbanPageModelsArgs): KanbanPageModels {
  const { activeRepo, isSwitchingWorkspace, loadRepoSettings } = useWorkspaceState();
  const {
    sessions,
    loadAgentSessions,
    startAgentSession,
    forkAgentSession,
    sendAgentMessage,
    updateAgentSessionModel,
  } = useAgentState();
  const {
    tasks,
    runs,
    refreshTasks,
    isLoadingTasks,
    deleteTask,
    deferTask,
    resumeDeferredTask,
    humanRequestChangesTask,
  } = useTasksState();
  const navigate = useNavigate();

  const { repoSettings } = useAgentStudioRepoSettings({
    activeRepo,
    loadRepoSettings,
  });

  const sessionStartFlow = useKanbanSessionStartFlow({
    activeRepo,
    repoSettings,
    tasks,
    sessions,
    navigate,
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
      onDelete: (taskId, options) => deleteTask(taskId, options.deleteSubtasks),
    },
    humanReviewFeedbackModal,
    taskApprovalModal,
    sessionStartModal,
  };
}
