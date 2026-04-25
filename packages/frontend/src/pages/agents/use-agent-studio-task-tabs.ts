import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  AGENT_STUDIO_QUERY_KEYS,
  type AgentStudioQueryUpdate as QueryUpdate,
} from "./agent-studio-navigation";
import { buildTaskTabs, getAvailableTabTasks } from "./agents-page-session-tabs";
import { useTaskTabActions } from "./use-agent-studio-task-tabs-actions";
import { useTaskTabPersistence } from "./use-agent-studio-task-tabs-persistence";
import { useTaskTabSelection } from "./use-agent-studio-task-tabs-selection";

const toTaskIntentQueryUpdate = (taskId: string): QueryUpdate => {
  return {
    [AGENT_STUDIO_QUERY_KEYS.task]: taskId,
    [AGENT_STUDIO_QUERY_KEYS.session]: undefined,
    [AGENT_STUDIO_QUERY_KEYS.agent]: undefined,
    [AGENT_STUDIO_QUERY_KEYS.scenario]: undefined,
    [AGENT_STUDIO_QUERY_KEYS.autostart]: undefined,
    [AGENT_STUDIO_QUERY_KEYS.start]: undefined,
  };
};

const toClearTaskQueryUpdate = (): QueryUpdate => ({
  [AGENT_STUDIO_QUERY_KEYS.task]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.session]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.agent]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.scenario]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.autostart]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.start]: undefined,
});

export function useAgentStudioTaskTabs(args: {
  activeWorkspace: ActiveWorkspace | null;
  isRepoNavigationBoundaryPending?: boolean;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  latestSessionByTaskId: Map<string, AgentSessionSummary>;
  activeSessionByTaskId?: Map<string, AgentSessionSummary>;
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
  handleReorderTab: (
    draggedTaskId: string,
    targetTaskId: string,
    position: "before" | "after",
  ) => void;
} {
  const {
    activeWorkspace,
    isRepoNavigationBoundaryPending = false,
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
  const [tabsStorageHydratedWorkspaceId, setTabsStorageHydratedWorkspaceId] = useState<
    string | null
  >(null);
  const taskIdForTabs = selectedTask?.status === "closed" ? "" : taskId;

  const selectableTaskIds = useMemo(
    () => new Set(tasks.filter((task) => task.status !== "closed").map((task) => task.id)),
    [tasks],
  );
  const selectableOpenTaskTabs = useMemo(
    () => openTaskTabs.filter((taskTabId) => selectableTaskIds.has(taskTabId)),
    [openTaskTabs, selectableTaskIds],
  );

  const navigateToTaskIntent = useCallback(
    (nextTaskId: string) => {
      updateQuery(toTaskIntentQueryUpdate(nextTaskId));
    },
    [updateQuery],
  );

  const clearTaskSelection = useCallback((): void => {
    updateQuery(toClearTaskQueryUpdate());
  }, [updateQuery]);

  const { tabTaskIds, activeTaskTabId, handleSelectTab } = useTaskTabSelection({
    activeWorkspace,
    isRepoNavigationBoundaryPending,
    taskId: taskIdForTabs,
    openTaskTabs: selectableOpenTaskTabs,
    persistedActiveTaskId,
    intentActiveTaskId,
    tabsStorageHydratedWorkspaceId,
    clearComposerInput,
    onContextSwitchIntent,
    navigateToTaskIntent,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
    setIntentActiveTaskId,
  });

  useTaskTabPersistence({
    activeWorkspace,
    taskId: taskIdForTabs,
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

  const { handleCreateTab, handleCloseTab, handleReorderTab } = useTaskTabActions({
    tabTaskIds,
    activeTaskTabId,
    clearComposerInput,
    onContextSwitchIntent,
    clearTaskSelection,
    navigateToTaskIntent,
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
    handleReorderTab,
  };
}
