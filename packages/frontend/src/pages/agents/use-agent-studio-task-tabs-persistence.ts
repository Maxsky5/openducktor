import type { TaskCard } from "@openducktor/contracts";
import { type Dispatch, type SetStateAction, useEffect } from "react";
import { errorMessage } from "@/lib/errors";
import type { ActiveWorkspace } from "@/types/state-slices";
import { toTabsStorageKey } from "./agents-page-selection";
import {
  canPersistTaskTabs,
  parsePersistedTaskTabs,
  toPersistedTaskTabs,
} from "./agents-page-session-tabs";

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
  activeWorkspace: ActiveWorkspace | null;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  openTaskTabs: string[];
  tabsStorageHydratedWorkspaceId: string | null;
  activeTaskTabId: string;
  setOpenTaskTabs: SetState<string[]>;
  setPersistedActiveTaskId: SetState<string | null>;
  setIntentActiveTaskId: SetState<string | null>;
  setTabsStorageHydratedWorkspaceId: SetState<string | null>;
};

export function useTaskTabPersistence(args: UseTaskTabPersistenceArgs): void {
  const {
    activeWorkspace,
    taskId,
    selectedTask,
    tasks,
    isLoadingTasks,
    openTaskTabs,
    tabsStorageHydratedWorkspaceId,
    activeTaskTabId,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setIntentActiveTaskId,
    setTabsStorageHydratedWorkspaceId,
  } = args;
  const activeWorkspaceId = activeWorkspace?.workspaceId ?? null;

  useEffect(() => {
    if (!activeWorkspaceId) {
      setOpenTaskTabs([]);
      setPersistedActiveTaskId(null);
      setIntentActiveTaskId(null);
      setTabsStorageHydratedWorkspaceId(null);
      return;
    }

    const tabsStorageKey = toTabsStorageKey(activeWorkspaceId);
    const raw = readTaskTabsStorage(tabsStorageKey);
    const persistedTabs = parsePersistedTaskTabs(raw);
    setOpenTaskTabs(persistedTabs.tabs);
    setPersistedActiveTaskId(persistedTabs.activeTaskId);
    setTabsStorageHydratedWorkspaceId(activeWorkspaceId);
  }, [
    activeWorkspaceId,
    setIntentActiveTaskId,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setTabsStorageHydratedWorkspaceId,
  ]);

  useEffect(() => {
    if (isLoadingTasks) {
      return;
    }
    const openTaskIds = new Set(
      tasks.filter((task) => task.status !== "closed").map((task) => task.id),
    );
    setOpenTaskTabs((current) => {
      const filtered = current.filter((taskTabId) => openTaskIds.has(taskTabId));
      if (filtered.length === current.length) {
        return current;
      }
      return filtered;
    });
  }, [isLoadingTasks, setOpenTaskTabs, tasks]);

  useEffect(() => {
    if (!taskId) {
      return;
    }
    if (!selectedTask) {
      return;
    }
    if (selectedTask.status === "closed") {
      return;
    }
    setOpenTaskTabs((current) => {
      if (current.includes(taskId)) {
        return current;
      }
      return [...current, taskId];
    });
  }, [selectedTask, setOpenTaskTabs, taskId]);

  useEffect(() => {
    if (!canPersistTaskTabs(activeWorkspaceId, tabsStorageHydratedWorkspaceId)) {
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
  }, [activeWorkspaceId, activeTaskTabId, openTaskTabs, tabsStorageHydratedWorkspaceId]);
}
