import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { startTransition, useCallback, useMemo, useState } from "react";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  AGENT_STUDIO_QUERY_KEYS,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "./agent-studio-navigation";
import {
  buildRoleEnabledMapForTask,
  buildTaskTabs,
  getAvailableTabTasks,
} from "./agents-page-session-tabs";
import { useTaskTabActions } from "./use-agent-studio-task-tabs-actions";
import { useTaskTabPersistence } from "./use-agent-studio-task-tabs-persistence";
import { useTaskTabSelection } from "./use-agent-studio-task-tabs-selection";

type TaskByIdMap = ReadonlyMap<string, TaskCard>;

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
      [AGENT_STUDIO_QUERY_KEYS.task]: sessionForTask.taskId,
      [AGENT_STUDIO_QUERY_KEYS.session]: sessionForTask.sessionId,
      [AGENT_STUDIO_QUERY_KEYS.agent]: sessionForTask.role,
      [AGENT_STUDIO_QUERY_KEYS.autostart]: undefined,
      [AGENT_STUDIO_QUERY_KEYS.start]: undefined,
    };
  }

  const nextTask = params.taskById.get(params.taskId) ?? null;
  const nextRole = resolveDefaultRoleForTask(nextTask);
  return {
    [AGENT_STUDIO_QUERY_KEYS.task]: params.taskId,
    [AGENT_STUDIO_QUERY_KEYS.session]: undefined,
    [AGENT_STUDIO_QUERY_KEYS.agent]: nextRole,
    [AGENT_STUDIO_QUERY_KEYS.autostart]: undefined,
    [AGENT_STUDIO_QUERY_KEYS.start]: undefined,
  };
};

const toClearTaskQueryUpdate = (): QueryUpdate => ({
  [AGENT_STUDIO_QUERY_KEYS.task]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.session]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.agent]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.autostart]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.start]: undefined,
});

export function useAgentStudioTaskTabs(args: {
  activeRepo: string | null;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  latestSessionByTaskId: Map<string, AgentSessionState>;
  activeSessionByTaskId?: Map<string, AgentSessionState>;
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
    activeSessionByTaskId,
    updateQuery,
    clearComposerInput,
    onContextSwitchIntent,
  } = args;

  const [openTaskTabs, setOpenTaskTabs] = useState<string[]>([]);
  const [persistedActiveTaskId, setPersistedActiveTaskId] = useState<string | null>(null);
  const [intentActiveTaskId, setIntentActiveTaskId] = useState<string | null>(null);
  const [tabsStorageHydratedRepo, setTabsStorageHydratedRepo] = useState<string | null>(null);
  const taskIdForTabs = selectedTask?.status === "closed" ? "" : taskId;

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
  const selectableTaskIds = useMemo(
    () => new Set(tasks.filter((task) => task.status !== "closed").map((task) => task.id)),
    [tasks],
  );
  const selectableOpenTaskTabs = useMemo(
    () => openTaskTabs.filter((taskTabId) => selectableTaskIds.has(taskTabId)),
    [openTaskTabs, selectableTaskIds],
  );

  const navigateToTask = useCallback(
    (nextTaskId: string) => {
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

  const clearTaskSelection = useCallback((): void => {
    deferQueryUpdate(toClearTaskQueryUpdate());
  }, [deferQueryUpdate]);

  const { tabTaskIds, activeTaskTabId, handleSelectTab } = useTaskTabSelection({
    activeRepo,
    taskId: taskIdForTabs,
    openTaskTabs: selectableOpenTaskTabs,
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
    taskId: taskIdForTabs,
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
        latestSessionByTaskId: activeSessionByTaskId ?? latestSessionByTaskId,
        activeTaskId: activeTaskTabId,
      }),
    [activeTaskTabId, activeSessionByTaskId, latestSessionByTaskId, tabTaskIds, tasks],
  );

  const { handleCreateTab, handleCloseTab } = useTaskTabActions({
    tabTaskIds,
    activeTaskTabId,
    clearComposerInput,
    onContextSwitchIntent,
    clearTaskSelection,
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
