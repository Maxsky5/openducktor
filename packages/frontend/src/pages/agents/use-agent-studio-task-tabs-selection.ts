import { useCallback, useEffect, useMemo, useRef } from "react";
import { ensureActiveTaskTab, resolveFallbackTaskId } from "./agent-studio-task-tabs-list";
import type { TaskTabState } from "./use-agent-studio-task-tabs-state";

type UseTaskTabSelectionArgs = {
  activeWorkspaceId: string | null;
  isWorkspaceRestorePending: boolean;
  taskId: string;
  tabTaskIds: string[];
  persistedActiveTaskId: string | null;
  loadedStateWorkspaceId: string | null;
  selectTask: (taskId: string) => void;
  setTaskTabState: (state: TaskTabState) => void;
};

type UseTaskTabSelectionResult = {
  tabTaskIds: string[];
  activeTaskTabId: string;
  handleSelectTab: (nextTaskId: string) => void;
};

export function useTaskTabSelection(args: UseTaskTabSelectionArgs): UseTaskTabSelectionResult {
  const {
    activeWorkspaceId,
    isWorkspaceRestorePending,
    taskId,
    tabTaskIds,
    persistedActiveTaskId,
    loadedStateWorkspaceId,
    selectTask,
    setTaskTabState,
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
      isWorkspaceRestorePending
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
    isWorkspaceRestorePending,
    persistedActiveTaskId,
    selectTask,
    tabTaskIds,
    loadedStateWorkspaceId,
    taskId,
  ]);

  useEffect(() => {
    if (!activeWorkspaceId || taskId || isWorkspaceRestorePending) {
      appliedFallbackKeyRef.current = null;
    }
  }, [activeWorkspaceId, isWorkspaceRestorePending, taskId]);

  const handleSelectTab = useCallback(
    (nextTaskId: string): void => {
      if (!nextTaskId) {
        return;
      }
      if (nextTaskId === activeTaskTabId) {
        return;
      }

      setTaskTabState({
        openTaskIds: ensureActiveTaskTab(tabTaskIds, nextTaskId),
        activeTaskId: nextTaskId,
      });
      selectTask(nextTaskId);
    },
    [activeTaskTabId, selectTask, setTaskTabState, tabTaskIds],
  );

  return {
    tabTaskIds,
    activeTaskTabId,
    handleSelectTab,
  };
}
