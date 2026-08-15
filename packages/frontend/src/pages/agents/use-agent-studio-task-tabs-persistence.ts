import type { TaskCard } from "@openducktor/contracts";
import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import {
  canPersistTaskTabs,
  parsePersistedTaskTabs,
  toPersistedTaskTabs,
} from "./agent-studio-task-tabs-storage";
import { toTabsStorageKey } from "./agents-page-selection";

type SetState<T> = Dispatch<SetStateAction<T>>;

const readTaskTabsStorage = (storageKey: string): string | null => {
  try {
    return globalThis.localStorage.getItem(storageKey);
  } catch (cause) {
    throw new Error(
      `Failed to read agent studio task tabs storage key "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
  }
};

const writeTaskTabsStorage = (storageKey: string, payload: string): void => {
  try {
    globalThis.localStorage.setItem(storageKey, payload);
  } catch (cause) {
    throw new Error(
      `Failed to persist agent studio task tabs storage key "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
  }
};

type UseTaskTabPersistenceArgs = {
  activeWorkspaceId: string | null;
  taskId: string;
  selectedTask: TaskCard | null;
  selectableTaskIds: ReadonlySet<string>;
  isLoadingTasks: boolean;
  openTaskTabs: string[];
  loadedTabsStorageWorkspaceId: string | null;
  activeTaskTabId: string;
  setOpenTaskTabs: SetState<string[]>;
  resetLoadedTaskTabsStorage: () => void;
  applyLoadedTaskTabsStorage: (
    tabs: string[],
    activeTaskId: string | null,
    workspaceId: string,
  ) => void;
};

export function useTaskTabPersistence(args: UseTaskTabPersistenceArgs): void {
  const {
    activeWorkspaceId,
    taskId,
    selectedTask,
    selectableTaskIds,
    isLoadingTasks,
    openTaskTabs,
    loadedTabsStorageWorkspaceId,
    activeTaskTabId,
    setOpenTaskTabs,
    resetLoadedTaskTabsStorage,
    applyLoadedTaskTabsStorage,
  } = args;
  const resetLoadedTaskTabsStorageRef = useRef(resetLoadedTaskTabsStorage);
  const applyLoadedTaskTabsStorageRef = useRef(applyLoadedTaskTabsStorage);
  resetLoadedTaskTabsStorageRef.current = resetLoadedTaskTabsStorage;
  applyLoadedTaskTabsStorageRef.current = applyLoadedTaskTabsStorage;

  useEffect(() => {
    if (!activeWorkspaceId) {
      resetLoadedTaskTabsStorageRef.current();
      return;
    }

    const tabsStorageKey = toTabsStorageKey(activeWorkspaceId);
    const raw = readTaskTabsStorage(tabsStorageKey);
    const persistedTabs = parsePersistedTaskTabs(raw);
    applyLoadedTaskTabsStorageRef.current(
      persistedTabs.tabs,
      persistedTabs.activeTaskId,
      activeWorkspaceId,
    );
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (isLoadingTasks) {
      return;
    }
    setOpenTaskTabs((current) => {
      const filtered = current.filter((taskTabId) => selectableTaskIds.has(taskTabId));
      if (filtered.length === current.length) {
        return current;
      }
      return filtered;
    });
  }, [isLoadingTasks, selectableTaskIds, setOpenTaskTabs]);

  useEffect(() => {
    if (!taskId) {
      return;
    }
    if (!selectedTask) {
      return;
    }
    if (!selectableTaskIds.has(taskId)) {
      return;
    }
    setOpenTaskTabs((current) => {
      if (current.includes(taskId)) {
        return current;
      }
      return [...current, taskId];
    });
  }, [selectableTaskIds, selectedTask, setOpenTaskTabs, taskId]);

  useEffect(() => {
    if (!canPersistTaskTabs(activeWorkspaceId, loadedTabsStorageWorkspaceId)) {
      return;
    }
    if (!activeWorkspaceId) {
      return;
    }

    const tabsStorageKey = toTabsStorageKey(activeWorkspaceId);
    writeTaskTabsStorage(
      tabsStorageKey,
      toPersistedTaskTabs({
        tabs: openTaskTabs,
        activeTaskId: activeTaskTabId || null,
      }),
    );
  }, [activeWorkspaceId, activeTaskTabId, loadedTabsStorageWorkspaceId, openTaskTabs]);
}
