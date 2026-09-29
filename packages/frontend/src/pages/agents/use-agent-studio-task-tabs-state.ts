import type { TaskCard, WorkspaceAgentStudioState } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ensureActiveTaskTab } from "./agent-studio-task-tabs-list";
import { pruneAgentStudioTaskIds } from "./agent-studio-workspace-state";

export type TaskTabState = {
  openTaskIds: string[];
  activeTaskId: string | null;
};
export type TabChangeListener = (
  baseOpenTaskIds: string[],
  nextState: TaskTabState,
  onSaved: () => void,
) => Promise<void> | void;

type PendingTabChange = TaskTabState & {
  workspaceId: string;
  loadKey: string;
  loadedOpenTaskIds: string[];
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
  onTabChange,
}: {
  activeWorkspaceId: string | null;
  loadedAgentStudioState: WorkspaceAgentStudioState | null;
  agentStudioStateLoadKey: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  tasksAreCurrent: boolean;
  onTabChange?: TabChangeListener | undefined;
}) {
  const [pendingTabChange, setPendingTabChange] = useState<PendingTabChange | null>(null);
  const hasLoadedState = Boolean(
    activeWorkspaceId &&
    loadedAgentStudioState &&
    agentStudioStateLoadKey !== null &&
    agentStudioState,
  );
  const hasPendingTabChange = Boolean(
    hasLoadedState &&
    pendingTabChange?.workspaceId === activeWorkspaceId &&
    pendingTabChange.loadKey === agentStudioStateLoadKey,
  );
  useEffect(() => {
    if (!hasPendingTabChange || !pendingTabChange || !loadedAgentStudioState) {
      return;
    }
    const savedTaskIds = loadedAgentStudioState.openTaskIds;
    if (
      savedTaskIds.length !== pendingTabChange.openTaskIds.length ||
      !savedTaskIds.every((taskId, index) => taskId === pendingTabChange.openTaskIds[index]) ||
      (loadedAgentStudioState.activeTask?.taskId ?? null) !== pendingTabChange.activeTaskId
    ) {
      return;
    }
    setPendingTabChange((current) => (current === pendingTabChange ? null : current));
  }, [hasPendingTabChange, loadedAgentStudioState, pendingTabChange]);

  const state = useMemo<TaskTabState>(() => {
    const hasValidRouteTask = Boolean(taskId && selectedTask && selectedTask.status !== "closed");

    if (!hasLoadedState || !agentStudioState) {
      return {
        openTaskIds: hasValidRouteTask ? [taskId] : [],
        activeTaskId: null,
      };
    }

    const pendingState = hasPendingTabChange ? pendingTabChange : null;
    const baseState = pendingState ?? {
      openTaskIds: agentStudioState.openTaskIds,
      activeTaskId: agentStudioState.activeTask?.taskId ?? null,
    };
    let openIds = baseState.openTaskIds;
    if (pendingState) {
      const loadedIds = new Set(pendingState.loadedOpenTaskIds);
      const pendingIds = new Set(pendingState.openTaskIds);
      openIds = [
        ...pendingState.openTaskIds,
        ...agentStudioState.openTaskIds.filter((id) => !loadedIds.has(id) && !pendingIds.has(id)),
      ];
    }
    const taskIds = tasksAreCurrent ? pruneAgentStudioTaskIds(openIds, tasks) : openIds;
    const openTaskIds = hasValidRouteTask ? ensureActiveTaskTab(taskIds, taskId) : taskIds;

    return {
      openTaskIds,
      activeTaskId: baseState.activeTaskId,
    };
  }, [
    agentStudioState,
    hasPendingTabChange,
    pendingTabChange,
    tasksAreCurrent,
    hasLoadedState,
    selectedTask,
    taskId,
    tasks,
  ]);

  const setTabState = useCallback(
    (nextState: TaskTabState): void => {
      if (!activeWorkspaceId || !loadedAgentStudioState || agentStudioStateLoadKey === null) {
        return;
      }
      const baseOpenTaskIds =
        hasPendingTabChange && pendingTabChange
          ? pendingTabChange.openTaskIds
          : loadedAgentStudioState.openTaskIds;
      const change = {
        workspaceId: activeWorkspaceId,
        loadKey: agentStudioStateLoadKey,
        loadedOpenTaskIds: loadedAgentStudioState.openTaskIds,
        ...nextState,
      };
      setPendingTabChange(change);
      void onTabChange?.(baseOpenTaskIds, nextState, () => {
        setPendingTabChange((current) => (current === change ? null : current));
      });
    },
    [
      activeWorkspaceId,
      loadedAgentStudioState,
      agentStudioStateLoadKey,
      hasPendingTabChange,
      pendingTabChange,
      onTabChange,
    ],
  );

  return {
    openTaskIds: state.openTaskIds,
    persistedActiveTaskId: state.activeTaskId,
    loadedStateWorkspaceId: hasLoadedState ? activeWorkspaceId : null,
    hasPendingTabChange,
    setTabState,
  };
}
