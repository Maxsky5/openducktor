import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useRef } from "react";
import type { NavigateToTask } from "./agent-studio-types";
import { ensureActiveTaskTab, resolveFallbackTaskId } from "./agents-page-session-tabs";

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseTaskTabSelectionArgs = {
  activeRepo: string | null;
  taskId: string;
  openTaskTabs: string[];
  persistedActiveTaskId: string | null;
  intentActiveTaskId: string | null;
  tabsStorageHydratedRepo: string | null;
  clearComposerInput: () => void;
  onContextSwitchIntent: (() => void) | undefined;
  navigateToTask: NavigateToTask;
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
    taskId,
    openTaskTabs,
    persistedActiveTaskId,
    intentActiveTaskId,
    tabsStorageHydratedRepo,
    clearComposerInput,
    onContextSwitchIntent,
    navigateToTask,
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
    if (!activeRepo || tabsStorageHydratedRepo !== activeRepo) {
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
    const fallbackKey = `${activeRepo}:${fallbackTaskId}`;
    if (appliedFallbackKeyRef.current === fallbackKey) {
      return;
    }
    appliedFallbackKeyRef.current = fallbackKey;
    navigateToTask(fallbackTaskId);
  }, [
    activeRepo,
    navigateToTask,
    persistedActiveTaskId,
    tabTaskIds,
    tabsStorageHydratedRepo,
    taskId,
  ]);

  useEffect(() => {
    if (!activeRepo || taskId) {
      appliedFallbackKeyRef.current = null;
    }
  }, [activeRepo, taskId]);

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
      navigateToTask(nextTaskId, { pinSession: true });
    },
    [
      activeTaskTabId,
      clearComposerInput,
      navigateToTask,
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
