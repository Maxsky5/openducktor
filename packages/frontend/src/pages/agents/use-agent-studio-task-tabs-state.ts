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
  tasksAreCurrent,
}: {
  activeWorkspaceId: string | null;
  loadedAgentStudioState: WorkspaceAgentStudioState | null;
  agentStudioStateLoadKey: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  tasksAreCurrent: boolean;
}) {
  const [draft, setDraft] = useState<TaskTabDraft | null>(null);
  const hasLoadedState = Boolean(
    activeWorkspaceId &&
    loadedAgentStudioState &&
    agentStudioStateLoadKey !== null &&
    agentStudioState,
  );
  const useDraft = Boolean(
    hasLoadedState &&
    draft?.workspaceId === activeWorkspaceId &&
    draft.loadKey === agentStudioStateLoadKey,
  );

  const state = useMemo<TaskTabState>(() => {
    const hasValidRouteTask = Boolean(taskId && selectedTask && selectedTask.status !== "closed");

    if (!hasLoadedState || !agentStudioState) {
      return {
        openTaskIds: hasValidRouteTask ? [taskId] : [],
        activeTaskId: null,
      };
    }

    const baseState =
      useDraft && draft
        ? draft
        : {
            openTaskIds: agentStudioState.openTaskIds,
            activeTaskId: agentStudioState.activeTask?.taskId ?? null,
          };
    const taskIds = tasksAreCurrent
      ? pruneAgentStudioTaskIds(baseState.openTaskIds, tasks)
      : baseState.openTaskIds;
    const openTaskIds = hasValidRouteTask ? ensureActiveTaskTab(taskIds, taskId) : taskIds;

    return {
      openTaskIds,
      activeTaskId: baseState.activeTaskId,
    };
  }, [
    agentStudioState,
    draft,
    tasksAreCurrent,
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
