import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import {
  type Dispatch,
  type SetStateAction,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { firstScenario } from "./agents-page-constants";
import {
  buildRoleEnabledMapForTask,
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

type SetState<T> = Dispatch<SetStateAction<T>>;

type TaskByIdMap = ReadonlyMap<string, TaskCard>;

type NavigateToTask = (taskId: string) => void;

const resolveDefaultRoleForTask = (task: TaskCard | null): AgentRole => {
  const roleEnabledByTask = buildRoleEnabledMapForTask(task);
  if (roleEnabledByTask.spec) {
    return "spec";
  }
  if (roleEnabledByTask.planner) {
    return "planner";
  }
  if (roleEnabledByTask.build) {
    return "build";
  }
  if (roleEnabledByTask.qa) {
    return "qa";
  }
  return "spec";
};

const toTaskQueryUpdate = (params: {
  taskId: string;
  latestSessionByTaskId: ReadonlyMap<string, AgentSessionState>;
  taskById: TaskByIdMap;
}): QueryUpdate => {
  const sessionForTask = params.latestSessionByTaskId.get(params.taskId);
  if (sessionForTask) {
    return {
      task: sessionForTask.taskId,
      session: sessionForTask.sessionId,
      agent: sessionForTask.role,
      scenario: sessionForTask.scenario,
      autostart: undefined,
      start: undefined,
    };
  }

  const nextTask = params.taskById.get(params.taskId) ?? null;
  const nextRole = resolveDefaultRoleForTask(nextTask);
  return {
    task: params.taskId,
    session: undefined,
    agent: nextRole,
    scenario: firstScenario(nextRole),
    autostart: undefined,
    start: undefined,
  };
};

const toClearTaskQueryUpdate = (): QueryUpdate => ({
  task: undefined,
  session: undefined,
  agent: undefined,
  scenario: undefined,
  autostart: undefined,
  start: undefined,
});

const focusTaskTabTrigger = (taskId: string): void => {
  globalThis.setTimeout(() => {
    if (typeof globalThis.document === "undefined") {
      return;
    }

    const nextTrigger = globalThis.document.getElementById(`agent-studio-tab-${taskId}`);
    if (nextTrigger instanceof HTMLElement) {
      nextTrigger.focus();
    }
  }, 0);
};

type UseTaskTabPersistenceArgs = {
  activeRepo: string | null;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  openTaskTabs: string[];
  tabsStorageHydratedRepo: string | null;
  activeTaskTabId: string;
  setOpenTaskTabs: SetState<string[]>;
  setPersistedActiveTaskId: SetState<string | null>;
  setIntentActiveTaskId: SetState<string | null>;
  setTabsStorageHydratedRepo: SetState<string | null>;
};

export function useTaskTabPersistence(args: UseTaskTabPersistenceArgs): void {
  const {
    activeRepo,
    taskId,
    selectedTask,
    tasks,
    isLoadingTasks,
    openTaskTabs,
    tabsStorageHydratedRepo,
    activeTaskTabId,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setIntentActiveTaskId,
    setTabsStorageHydratedRepo,
  } = args;

  useEffect(() => {
    if (!activeRepo) {
      setOpenTaskTabs([]);
      setPersistedActiveTaskId(null);
      setIntentActiveTaskId(null);
      setTabsStorageHydratedRepo(null);
      return;
    }

    const raw = globalThis.localStorage.getItem(toTabsStorageKey(activeRepo));
    const persistedTabs = parsePersistedTaskTabs(raw);
    setOpenTaskTabs(persistedTabs.tabs);
    setPersistedActiveTaskId(persistedTabs.activeTaskId);
    setTabsStorageHydratedRepo(activeRepo);
  }, [
    activeRepo,
    setIntentActiveTaskId,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setTabsStorageHydratedRepo,
  ]);

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
  }, [isLoadingTasks, setOpenTaskTabs, tasks]);

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
  }, [selectedTask, setOpenTaskTabs, taskId]);

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
        activeTaskId: activeTaskTabId || null,
      }),
    );
  }, [activeRepo, activeTaskTabId, openTaskTabs, tabsStorageHydratedRepo]);
}

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
    navigateToTask(fallbackTaskId);
  }, [
    activeRepo,
    navigateToTask,
    persistedActiveTaskId,
    tabTaskIds,
    tabsStorageHydratedRepo,
    taskId,
  ]);

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
      navigateToTask(nextTaskId);
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

type UseTaskTabActionsArgs = {
  tabTaskIds: string[];
  activeTaskTabId: string;
  clearComposerInput: () => void;
  onContextSwitchIntent: (() => void) | undefined;
  deferQueryUpdate: (updates: QueryUpdate) => void;
  navigateToTask: NavigateToTask;
  handleSelectTab: (nextTaskId: string) => void;
  setOpenTaskTabs: SetState<string[]>;
  setPersistedActiveTaskId: SetState<string | null>;
  setIntentActiveTaskId: SetState<string | null>;
};

type UseTaskTabActionsResult = {
  handleCreateTab: (nextTaskId: string) => void;
  handleCloseTab: (taskIdToClose: string) => void;
};

export function useTaskTabActions(args: UseTaskTabActionsArgs): UseTaskTabActionsResult {
  const {
    tabTaskIds,
    activeTaskTabId,
    clearComposerInput,
    onContextSwitchIntent,
    deferQueryUpdate,
    navigateToTask,
    handleSelectTab,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setIntentActiveTaskId,
  } = args;

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
        activeTaskId: activeTaskTabId,
      });

      if (nextTabTaskIds === tabTaskIds) {
        return;
      }

      setOpenTaskTabs(nextTabTaskIds);
      setPersistedActiveTaskId(nextActiveTaskId ?? null);

      if (taskIdToClose !== activeTaskTabId) {
        return;
      }

      clearComposerInput();
      onContextSwitchIntent?.();
      setIntentActiveTaskId(nextActiveTaskId ?? null);

      if (!nextActiveTaskId) {
        deferQueryUpdate(toClearTaskQueryUpdate());
        return;
      }

      focusTaskTabTrigger(nextActiveTaskId);
      navigateToTask(nextActiveTaskId);
    },
    [
      activeTaskTabId,
      clearComposerInput,
      deferQueryUpdate,
      navigateToTask,
      onContextSwitchIntent,
      setIntentActiveTaskId,
      setOpenTaskTabs,
      setPersistedActiveTaskId,
      tabTaskIds,
    ],
  );

  return {
    handleCreateTab,
    handleCloseTab,
  };
}

export function useAgentStudioTaskTabs(args: {
  activeRepo: string | null;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  latestSessionByTaskId: Map<string, AgentSessionState>;
  updateQuery: (updates: QueryUpdate) => void;
  clearComposerInput: () => void;
  onContextSwitchIntent?: () => void;
}): {
  tabTaskIds: string[];
  activeTaskTabId: string;
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
    onContextSwitchIntent,
  } = args;

  const [openTaskTabs, setOpenTaskTabs] = useState<string[]>([]);
  const [persistedActiveTaskId, setPersistedActiveTaskId] = useState<string | null>(null);
  const [intentActiveTaskId, setIntentActiveTaskId] = useState<string | null>(null);
  const [tabsStorageHydratedRepo, setTabsStorageHydratedRepo] = useState<string | null>(null);

  const deferQueryUpdate = useCallback(
    (updates: QueryUpdate): void => {
      startTransition(() => {
        updateQuery(updates);
      });
    },
    [updateQuery],
  );

  const taskById = useMemo<TaskByIdMap>(
    () => new Map(tasks.map((task): [string, TaskCard] => [task.id, task])),
    [tasks],
  );

  const navigateToTask = useCallback<NavigateToTask>(
    (nextTaskId) => {
      deferQueryUpdate(
        toTaskQueryUpdate({
          taskId: nextTaskId,
          latestSessionByTaskId,
          taskById,
        }),
      );
    },
    [deferQueryUpdate, latestSessionByTaskId, taskById],
  );

  const { tabTaskIds, activeTaskTabId, handleSelectTab } = useTaskTabSelection({
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
  });

  useTaskTabPersistence({
    activeRepo,
    taskId,
    selectedTask,
    tasks,
    isLoadingTasks,
    openTaskTabs,
    tabsStorageHydratedRepo,
    activeTaskTabId,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setIntentActiveTaskId,
    setTabsStorageHydratedRepo,
  });

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
        activeTaskId: activeTaskTabId,
      }),
    [activeTaskTabId, latestSessionByTaskId, tabTaskIds, tasks],
  );

  const { handleCreateTab, handleCloseTab } = useTaskTabActions({
    tabTaskIds,
    activeTaskTabId,
    clearComposerInput,
    onContextSwitchIntent,
    deferQueryUpdate,
    navigateToTask,
    handleSelectTab,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setIntentActiveTaskId,
  });

  return {
    tabTaskIds,
    activeTaskTabId,
    availableTabTasks,
    taskTabs,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
  };
}
