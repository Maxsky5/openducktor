import type { TaskCard, WorkspaceAgentStudioState } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import { ensureActiveTaskTab } from "./agent-studio-task-tabs-list";
import { pruneAgentStudioTaskIds } from "./agent-studio-workspace-state";

export type TaskTabState = {
  openTaskIds: string[];
  activeTaskId: string | null;
};

type TaskTabDraft = TaskTabState & {
  workspaceId: string;
  loadKey: string;
};

export function useTaskTabState({
  activeWorkspaceId,
  loadedAgentStudioState,
  agentStudioStateLoadKey,
  agentStudioState,
  taskId,
  selectedTask,
  tasks,
  isLoadingTasks,
}: {
  activeWorkspaceId: string | null;
  loadedAgentStudioState: WorkspaceAgentStudioState | null;
  agentStudioStateLoadKey: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
}) {
  const [draft, setDraft] = useState<TaskTabDraft | null>(null);
  const useDraft = Boolean(
    activeWorkspaceId &&
    loadedAgentStudioState &&
    agentStudioStateLoadKey !== null &&
    draft?.workspaceId === activeWorkspaceId &&
    draft.loadKey === agentStudioStateLoadKey,
  );
  const hasLoadedState = Boolean(
    activeWorkspaceId &&
    loadedAgentStudioState &&
    agentStudioStateLoadKey !== null &&
    agentStudioState,
  );

  const state = useMemo<TaskTabState>(() => {
    if (!hasLoadedState || !agentStudioState) {
      return { openTaskIds: [], activeTaskId: null };
    }

    const baseState =
      useDraft && draft
        ? draft
        : {
            openTaskIds: agentStudioState.openTaskIds,
            activeTaskId: agentStudioState.activeTask?.taskId ?? null,
          };
    const taskIds = isLoadingTasks
      ? baseState.openTaskIds
      : pruneAgentStudioTaskIds(baseState.openTaskIds, tasks);
    const hasValidRouteTask = Boolean(taskId && selectedTask && selectedTask.status !== "closed");
    const openTaskIds = hasValidRouteTask ? ensureActiveTaskTab(taskIds, taskId) : taskIds;

    return {
      openTaskIds,
      activeTaskId: baseState.activeTaskId,
    };
  }, [
    agentStudioState,
    draft,
    isLoadingTasks,
    hasLoadedState,
    selectedTask,
    taskId,
    tasks,
    useDraft,
  ]);

  const setTabState = useCallback(
    (nextState: TaskTabState): void => {
      if (!activeWorkspaceId || !loadedAgentStudioState || agentStudioStateLoadKey === null) {
        return;
      }
      setDraft({
        workspaceId: activeWorkspaceId,
        loadKey: agentStudioStateLoadKey,
        ...nextState,
      });
    },
    [activeWorkspaceId, loadedAgentStudioState, agentStudioStateLoadKey],
  );

  return {
    openTaskIds: state.openTaskIds,
    persistedActiveTaskId: state.activeTaskId,
    loadedStateWorkspaceId: hasLoadedState ? activeWorkspaceId : null,
    setTabState,
  };
}
