import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef } from "react";
import type { NavigateToTaskIntent } from "./agent-studio-types";
import { ensureActiveTaskTab, resolveFallbackTaskId } from "./agents-page-session-tabs";

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseTaskTabSelectionArgs = {
  activeRepo: string | null;
  persistenceWorkspaceId: string | null;
  isRepoNavigationBoundaryPending: boolean;
  taskId: string;
  openTaskTabs: string[];
  persistedActiveTaskId: string | null;
  intentActiveTaskId: string | null;
  tabsStorageHydratedWorkspaceId: string | null;
  clearComposerInput: () => void;
  onContextSwitchIntent: (() => void) | undefined;
  navigateToTaskIntent: NavigateToTaskIntent;
  setOpenTaskTabs: SetState<string[]>;
  setPersistedActiveTaskId: SetState<string | null>;
  setIntentActiveTaskId: SetState<string | null>;
};

type UseTaskTabSelectionResult = {
  tabTaskIds: string[];
  activeTaskTabId: string;
  handleSelectTab: (nextTaskId: string) => void;
};

export function useTaskTabSelection(args: UseTaskTabSelectionArgs): UseTaskTabSelectionResult {
  const {
    activeRepo,
    persistenceWorkspaceId,
    isRepoNavigationBoundaryPending,
    taskId,
    openTaskTabs,
    persistedActiveTaskId,
    intentActiveTaskId,
    tabsStorageHydratedWorkspaceId,
    clearComposerInput,
    onContextSwitchIntent,
    navigateToTaskIntent,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setIntentActiveTaskId,
  } = args;

  const tabTaskIds = useMemo(
    () => ensureActiveTaskTab(openTaskTabs, taskId),
    [openTaskTabs, taskId],
  );
  const appliedFallbackKeyRef = useRef<string | null>(null);

  const activeTaskTabId = useMemo(() => {
    if (intentActiveTaskId && tabTaskIds.includes(intentActiveTaskId)) {
      return intentActiveTaskId;
    }
    if (taskId && tabTaskIds.includes(taskId)) {
      return taskId;
    }
    if (persistedActiveTaskId && tabTaskIds.includes(persistedActiveTaskId)) {
      return persistedActiveTaskId;
    }
    return tabTaskIds[0] ?? "";
  }, [intentActiveTaskId, persistedActiveTaskId, tabTaskIds, taskId]);

  useEffect(() => {
    if (!intentActiveTaskId) {
      return;
    }
    if (!tabTaskIds.includes(intentActiveTaskId) || taskId === intentActiveTaskId) {
      setIntentActiveTaskId(null);
    }
  }, [intentActiveTaskId, setIntentActiveTaskId, tabTaskIds, taskId]);

  useEffect(() => {
    if (
      !activeRepo ||
      !persistenceWorkspaceId ||
      tabsStorageHydratedWorkspaceId !== persistenceWorkspaceId ||
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
    const fallbackKey = `${persistenceWorkspaceId}:${fallbackTaskId}`;
    if (appliedFallbackKeyRef.current === fallbackKey) {
      return;
    }
    appliedFallbackKeyRef.current = fallbackKey;
    navigateToTaskIntent(fallbackTaskId);
  }, [
    activeRepo,
    persistenceWorkspaceId,
    isRepoNavigationBoundaryPending,
    navigateToTaskIntent,
    persistedActiveTaskId,
    tabTaskIds,
    tabsStorageHydratedWorkspaceId,
    taskId,
  ]);

  useEffect(() => {
    if (!activeRepo || taskId || isRepoNavigationBoundaryPending) {
      appliedFallbackKeyRef.current = null;
    }
  }, [activeRepo, isRepoNavigationBoundaryPending, taskId]);

  const handleSelectTab = useCallback(
    (nextTaskId: string): void => {
      if (!nextTaskId) {
        return;
      }
      if (nextTaskId === activeTaskTabId) {
        return;
      }

      onContextSwitchIntent?.();
      clearComposerInput();
      setIntentActiveTaskId(nextTaskId);
      setOpenTaskTabs((current) => {
        if (current.includes(nextTaskId)) {
          return current;
        }
        return [...current, nextTaskId];
      });
      setPersistedActiveTaskId(nextTaskId);
      navigateToTaskIntent(nextTaskId);
    },
    [
      activeTaskTabId,
      clearComposerInput,
      navigateToTaskIntent,
      onContextSwitchIntent,
      setIntentActiveTaskId,
      setOpenTaskTabs,
      setPersistedActiveTaskId,
    ],
  );

  return {
    tabTaskIds,
    activeTaskTabId,
    handleSelectTab,
  };
}
