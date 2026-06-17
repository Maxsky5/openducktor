import type { TaskCard } from "@openducktor/contracts";
import { isRecord } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { toTabsStorageKey } from "./query-sync/agent-studio-navigation";

type PersistedTaskTabsPayload = {
  tabs: string[];
  activeTaskId?: string | null;
};

export type PersistedTaskTabsState = {
  tabs: string[];
  activeTaskId: string | null;
};

const DEFAULT_PERSISTED_TABS_STATE: PersistedTaskTabsState = {
  tabs: [],
  activeTaskId: null,
};

const normalizeTaskTabs = (entries: unknown): string[] => {
  if (!Array.isArray(entries)) {
    return [];
  }
  return Array.from(
    new Set(
      entries.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      ),
    ),
  );
};

export const parsePersistedTaskTabs = (raw: string | null): PersistedTaskTabsState => {
  if (!raw) {
    return DEFAULT_PERSISTED_TABS_STATE;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed)) {
      return {
        tabs: normalizeTaskTabs(parsed),
        activeTaskId: null,
      };
    }

    if (!isRecord(parsed)) {
      return DEFAULT_PERSISTED_TABS_STATE;
    }

    const tabs = normalizeTaskTabs(parsed.tabs);
    const activeTaskId =
      typeof parsed.activeTaskId === "string" && parsed.activeTaskId.trim().length > 0
        ? parsed.activeTaskId
        : null;
    return {
      tabs,
      activeTaskId,
    };
  } catch {
    return DEFAULT_PERSISTED_TABS_STATE;
  }
};

export const toPersistedTaskTabs = (state: PersistedTaskTabsState): string => {
  const activeTaskId =
    state.activeTaskId && state.tabs.includes(state.activeTaskId) ? state.activeTaskId : null;
  return JSON.stringify({
    tabs: normalizeTaskTabs(state.tabs),
    activeTaskId,
  } satisfies PersistedTaskTabsPayload);
};

export const addTaskToPersistedTaskTabs = (params: {
  raw: string | null;
  taskId: string;
  tasks: TaskCard[];
}): string | null => {
  const taskId = params.taskId.trim();
  if (!taskId) {
    return null;
  }

  const task = params.tasks.find((entry) => entry.id === taskId) ?? null;
  if (!task || task.status === "closed") {
    return null;
  }

  const persisted = parsePersistedTaskTabs(params.raw);
  if (persisted.tabs.includes(taskId)) {
    return toPersistedTaskTabs(persisted);
  }

  return toPersistedTaskTabs({
    tabs: [...persisted.tabs, taskId],
    activeTaskId: persisted.activeTaskId,
  });
};

export const addTaskToPersistedAgentStudioTabs = (params: {
  workspaceId: string;
  taskId: string;
  tasks: TaskCard[];
}): void => {
  const storageKey = toTabsStorageKey(params.workspaceId);
  let raw: string | null;
  try {
    raw = globalThis.localStorage.getItem(storageKey);
  } catch (cause) {
    throw new Error(
      `Failed to read agent studio task tabs storage key "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
  }

  const next = addTaskToPersistedTaskTabs({
    raw,
    taskId: params.taskId,
    tasks: params.tasks,
  });
  if (next === null || next === raw) {
    return;
  }

  try {
    globalThis.localStorage.setItem(storageKey, next);
  } catch (cause) {
    throw new Error(
      `Failed to persist agent studio task tabs storage key "${storageKey}": ${errorMessage(cause)}`,
      { cause },
    );
  }
};

export const canPersistTaskTabs = (
  activeWorkspaceId: string | null,
  loadedTabsStorageWorkspaceId: string | null,
): boolean => {
  return Boolean(activeWorkspaceId) && loadedTabsStorageWorkspaceId === activeWorkspaceId;
};
