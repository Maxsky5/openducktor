import { useCallback, useEffect, useMemo, useRef } from "react";
import { ensureActiveTaskTab, resolveFallbackTaskId } from "./agent-studio-task-tabs-list";
import type { TaskTabStateUpdate } from "./use-agent-studio-task-tabs-state";

type UseTaskTabSelectionArgs = {
  activeWorkspaceId: string | null;
  isRepoNavigationBoundaryPending: boolean;
  taskId: string;
  tabTaskIds: string[];
  persistedActiveTaskId: string | null;
  loadedStateWorkspaceId: string | null;
  selectTask: (taskId: string) => void;
  updateTaskTabState: (state: TaskTabStateUpdate) => void;
};

type UseTaskTabSelectionResult = {
  tabTaskIds: string[];
  activeTaskTabId: string;
  handleSelectTab: (nextTaskId: string) => void;
};

export function useTaskTabSelection(args: UseTaskTabSelectionArgs): UseTaskTabSelectionResult {
  const {
    activeWorkspaceId,
    isRepoNavigationBoundaryPending,
    taskId,
    tabTaskIds,
    persistedActiveTaskId,
    loadedStateWorkspaceId,
    selectTask,
    updateTaskTabState,
  } = args;
  const appliedFallbackKeyRef = useRef<string | null>(null);

  const activeTaskTabId = useMemo(() => {
    if (taskId && tabTaskIds.includes(taskId)) {
      return taskId;
    }
    if (persistedActiveTaskId && tabTaskIds.includes(persistedActiveTaskId)) {
      return persistedActiveTaskId;
    }
    return tabTaskIds[0] ?? "";
  }, [persistedActiveTaskId, tabTaskIds, taskId]);

  useEffect(() => {
    if (
      !activeWorkspaceId ||
      loadedStateWorkspaceId !== activeWorkspaceId ||
      isRepoNavigationBoundaryPending
    ) {
      return;
    }
    if (taskId || tabTaskIds.length === 0) {
      return;
    }
    const fallbackTaskId = resolveFallbackTaskId({
      tabTaskIds,
      persistedActiveTaskId,
    });
    if (!fallbackTaskId) {
      return;
    }
    const fallbackKey = `${activeWorkspaceId}:${fallbackTaskId}`;
    if (appliedFallbackKeyRef.current === fallbackKey) {
      return;
    }
    appliedFallbackKeyRef.current = fallbackKey;
    selectTask(fallbackTaskId);
  }, [
    activeWorkspaceId,
    isRepoNavigationBoundaryPending,
    persistedActiveTaskId,
    selectTask,
    tabTaskIds,
    loadedStateWorkspaceId,
    taskId,
  ]);

  useEffect(() => {
    if (!activeWorkspaceId || taskId || isRepoNavigationBoundaryPending) {
      appliedFallbackKeyRef.current = null;
    }
  }, [activeWorkspaceId, isRepoNavigationBoundaryPending, taskId]);

  const handleSelectTab = useCallback(
    (nextTaskId: string): void => {
      if (!nextTaskId) {
        return;
      }
      if (nextTaskId === activeTaskTabId) {
        return;
      }

      updateTaskTabState({
        openTaskIds: ensureActiveTaskTab(tabTaskIds, nextTaskId),
        activeTaskId: nextTaskId,
      });
      selectTask(nextTaskId);
    },
    [activeTaskTabId, selectTask, tabTaskIds, updateTaskTabState],
  );

  return {
    tabTaskIds,
    activeTaskTabId,
    handleSelectTab,
  };
}
