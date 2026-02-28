import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAgentState, useTasksState, useWorkspaceState } from "@/state";
import type { KanbanPageModels } from "./kanban-page-model-types";
import { useAgentStudioRepoSettings } from "./use-agent-studio-repo-settings";
import { useKanbanBoardModel } from "./use-kanban-board-model";
import { useKanbanSessionStartFlow } from "./use-kanban-session-start-flow";
import { useKanbanTaskDialogs } from "./use-kanban-task-dialogs";

export function useKanbanPageModels(): KanbanPageModels {
  const { activeRepo, isSwitchingWorkspace, loadRepoSettings } = useWorkspaceState();
  const { sessions, startAgentSession, sendAgentMessage, updateAgentSessionModel } =
    useAgentState();
  const {
    tasks,
    runs,
    refreshTasks,
    isLoadingTasks,
    deleteTask,
    deferTask,
    resumeDeferredTask,
    humanApproveTask,
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
    startAgentSession,
    sendAgentMessage,
    updateAgentSessionModel,
  });

  const onRefreshTasks = useCallback((): void => {
    void refreshTasks();
  }, [refreshTasks]);

  const onHumanApprove = useCallback(
    (taskId: string): void => {
      void humanApproveTask(taskId);
    },
    [humanApproveTask],
  );

  const onHumanRequestChanges = useCallback(
    (taskId: string): void => {
      void (async () => {
        await humanRequestChangesTask(taskId);
        sessionStartFlow.openBuildAfterHumanRequestChanges(taskId);
      })();
    },
    [humanRequestChangesTask, sessionStartFlow],
  );

  const taskDialogs = useKanbanTaskDialogs({
    tasks,
    onPlan: sessionStartFlow.onPlan,
    onBuild: sessionStartFlow.onBuild,
    onDelegate: sessionStartFlow.onDelegate,
    onDefer: (taskId) => {
      void deferTask(taskId);
    },
    onResumeDeferred: (taskId) => {
      void resumeDeferredTask(taskId);
    },
    onHumanApprove,
    onHumanRequestChanges,
    onDelete: (taskId, options) => deleteTask(taskId, options.deleteSubtasks),
  });

  const content = useKanbanBoardModel({
    tasks,
    runs,
    sessions,
    onOpenDetails: taskDialogs.onOpenDetails,
    onDelegate: sessionStartFlow.onDelegate,
    onPlan: sessionStartFlow.onPlan,
    onBuild: sessionStartFlow.onBuild,
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
    detailsSheet: taskDialogs.detailsSheet,
    sessionStartModal: sessionStartFlow.sessionStartModal,
  };
}
