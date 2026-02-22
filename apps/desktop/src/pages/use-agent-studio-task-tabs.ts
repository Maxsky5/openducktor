import type { AgentStudioTaskTabsModel } from "@/components/features/agents/agent-studio-task-tabs";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildTaskTabs,
  canPersistTaskTabs,
  closeTaskTab,
  ensureActiveTaskTab,
  getAvailableTabTasks,
  parsePersistedTaskTabs,
  resolveFallbackTaskId,
  toPersistedTaskTabs,
} from "./agents-page-session-tabs";
import { toTabsStorageKey } from "./agents-page-utils";

type QueryUpdate = Record<string, string | undefined>;

export function useAgentStudioTaskTabs(args: {
  activeRepo: string | null;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  latestSessionByTaskId: Map<string, AgentSessionState>;
  updateQuery: (updates: QueryUpdate) => void;
  clearComposerInput: () => void;
}): {
  tabTaskIds: string[];
  availableTabTasks: TaskCard[];
  taskTabs: AgentStudioTaskTabsModel["tabs"];
  handleSelectTab: (nextTaskId: string) => void;
  handleCreateTab: (nextTaskId: string) => void;
  handleCloseTab: (taskIdToClose: string) => void;
} {
  const {
    activeRepo,
    taskId,
    selectedTask,
    tasks,
    isLoadingTasks,
    latestSessionByTaskId,
    updateQuery,
    clearComposerInput,
  } = args;

  const [openTaskTabs, setOpenTaskTabs] = useState<string[]>([]);
  const [persistedActiveTaskId, setPersistedActiveTaskId] = useState<string | null>(null);
  const [tabsStorageHydratedRepo, setTabsStorageHydratedRepo] = useState<string | null>(null);

  const tabTaskIds = useMemo(
    () => ensureActiveTaskTab(openTaskTabs, taskId),
    [openTaskTabs, taskId],
  );

  const availableTabTasks = useMemo(
    () => getAvailableTabTasks(tasks, tabTaskIds),
    [tabTaskIds, tasks],
  );

  const taskTabs = useMemo(
    () =>
      buildTaskTabs({
        tabTaskIds,
        tasks,
        latestSessionByTaskId,
        activeTaskId: taskId,
      }),
    [latestSessionByTaskId, tabTaskIds, taskId, tasks],
  );

  useEffect(() => {
    if (!activeRepo) {
      setOpenTaskTabs([]);
      setPersistedActiveTaskId(null);
      setTabsStorageHydratedRepo(null);
      return;
    }

    const raw = globalThis.localStorage.getItem(toTabsStorageKey(activeRepo));
    const persistedTabs = parsePersistedTaskTabs(raw);
    setOpenTaskTabs(persistedTabs.tabs);
    setPersistedActiveTaskId(persistedTabs.activeTaskId);
    setTabsStorageHydratedRepo(activeRepo);
  }, [activeRepo]);

  useEffect(() => {
    if (isLoadingTasks) {
      return;
    }
    const knownTaskIds = new Set(tasks.map((task) => task.id));
    setOpenTaskTabs((current) => {
      const filtered = current.filter((taskTabId) => knownTaskIds.has(taskTabId));
      if (filtered.length === current.length) {
        return current;
      }
      return filtered;
    });
  }, [isLoadingTasks, tasks]);

  useEffect(() => {
    if (!taskId) {
      return;
    }
    if (!selectedTask) {
      return;
    }
    setOpenTaskTabs((current) => {
      if (current.includes(taskId)) {
        return current;
      }
      return [...current, taskId];
    });
  }, [selectedTask, taskId]);

  useEffect(() => {
    if (!canPersistTaskTabs(activeRepo, tabsStorageHydratedRepo)) {
      return;
    }
    if (!activeRepo) {
      return;
    }
    globalThis.localStorage.setItem(
      toTabsStorageKey(activeRepo),
      toPersistedTaskTabs({
        tabs: openTaskTabs,
        activeTaskId: taskId || null,
      }),
    );
  }, [activeRepo, openTaskTabs, tabsStorageHydratedRepo, taskId]);

  useEffect(() => {
    if (taskId || openTaskTabs.length === 0) {
      return;
    }
    const fallbackTaskId = resolveFallbackTaskId({
      tabTaskIds: openTaskTabs,
      persistedActiveTaskId,
    });
    if (!fallbackTaskId) {
      return;
    }
    updateQuery({
      task: fallbackTaskId,
      session: undefined,
      autostart: undefined,
    });
  }, [openTaskTabs, persistedActiveTaskId, taskId, updateQuery]);

  const handleSelectTab = useCallback(
    (nextTaskId: string): void => {
      if (!nextTaskId) {
        return;
      }

      clearComposerInput();
      setOpenTaskTabs((current) => {
        if (current.includes(nextTaskId)) {
          return current;
        }
        return [...current, nextTaskId];
      });
      setPersistedActiveTaskId(nextTaskId);

      const sessionForTask = latestSessionByTaskId.get(nextTaskId);
      if (sessionForTask) {
        updateQuery({
          task: sessionForTask.taskId,
          session: sessionForTask.sessionId,
          autostart: undefined,
        });
        return;
      }

      updateQuery({
        task: nextTaskId,
        session: undefined,
        autostart: undefined,
      });
    },
    [clearComposerInput, latestSessionByTaskId, updateQuery],
  );

  const handleCreateTab = useCallback(
    (nextTaskId: string): void => {
      handleSelectTab(nextTaskId);
    },
    [handleSelectTab],
  );

  const handleCloseTab = useCallback(
    (taskIdToClose: string): void => {
      const { nextTabTaskIds, nextActiveTaskId } = closeTaskTab({
        tabTaskIds,
        taskIdToClose,
        activeTaskId: taskId,
      });

      if (nextTabTaskIds === tabTaskIds) {
        return;
      }

      setOpenTaskTabs(nextTabTaskIds);
      setPersistedActiveTaskId(nextActiveTaskId ?? null);

      if (taskIdToClose !== taskId) {
        return;
      }

      clearComposerInput();
      if (!nextActiveTaskId) {
        updateQuery({
          task: undefined,
          session: undefined,
          autostart: undefined,
        });
        return;
      }

      globalThis.setTimeout(() => {
        const nextTrigger = globalThis.document.getElementById(
          `agent-studio-tab-${nextActiveTaskId}`,
        );
        if (nextTrigger instanceof HTMLElement) {
          nextTrigger.focus();
        }
      }, 0);

      const fallbackSession = latestSessionByTaskId.get(nextActiveTaskId);
      if (fallbackSession) {
        updateQuery({
          task: fallbackSession.taskId,
          session: fallbackSession.sessionId,
          autostart: undefined,
        });
        return;
      }

      updateQuery({
        task: nextActiveTaskId,
        session: undefined,
        autostart: undefined,
      });
    },
    [clearComposerInput, latestSessionByTaskId, tabTaskIds, taskId, updateQuery],
  );

  return {
    tabTaskIds,
    availableTabTasks,
    taskTabs,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
  };
}
