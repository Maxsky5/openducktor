import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef } from "react";
import { ensureActiveTaskTab, resolveFallbackTaskId } from "./agent-studio-task-tabs-list";

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseTaskTabSelectionArgs = {
  activeWorkspaceId: string | null;
  isRepoNavigationBoundaryPending: boolean;
  taskId: string;
  openTaskTabs: string[];
  persistedActiveTaskId: string | null;
  loadedTabsStorageWorkspaceId: string | null;
  selectTask: (taskId: string) => void;
  setOpenTaskTabs: SetState<string[]>;
  setPersistedActiveTaskId: SetState<string | null>;
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
    openTaskTabs,
    persistedActiveTaskId,
    loadedTabsStorageWorkspaceId,
    selectTask,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
  } = args;

  const tabTaskIds = useMemo(
    () => ensureActiveTaskTab(openTaskTabs, taskId),
    [openTaskTabs, taskId],
  );
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
      loadedTabsStorageWorkspaceId !== activeWorkspaceId ||
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
    loadedTabsStorageWorkspaceId,
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

      setOpenTaskTabs((current) => {
        if (current.includes(nextTaskId)) {
          return current;
        }
        return [...current, nextTaskId];
      });
      setPersistedActiveTaskId(nextTaskId);
      selectTask(nextTaskId);
    },
    [activeTaskTabId, selectTask, setOpenTaskTabs, setPersistedActiveTaskId],
  );

  return {
    tabTaskIds,
    activeTaskTabId,
    handleSelectTab,
  };
}
