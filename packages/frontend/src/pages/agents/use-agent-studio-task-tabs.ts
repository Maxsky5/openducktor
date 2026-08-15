import type { TaskCard } from "@openducktor/contracts";
import { useCallback, useMemo, useState } from "react";
import type { AgentStudioTaskTabsModel } from "@/components/features/agents";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { getAvailableTabTasks } from "./agent-studio-task-tabs-list";
import { buildTaskTabs } from "./agents-page-session-tabs";
import {
  emptyAgentStudioSelectionState,
  type SelectAgentStudioSelection,
  toAgentStudioTaskSelection,
} from "./shell/agent-studio-selection-state";
import { useTaskTabActions } from "./use-agent-studio-task-tabs-actions";
import { useTaskTabPersistence } from "./use-agent-studio-task-tabs-persistence";
import { useTaskTabSelection } from "./use-agent-studio-task-tabs-selection";

export function useAgentStudioTaskTabs(args: {
  activeWorkspaceId: string | null;
  isRepoNavigationBoundaryPending?: boolean;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  isSessionReadModelReady: boolean;
  latestSessionByTaskId: Map<string, AgentSessionSummary>;
  activeSessionByTaskId?: Map<string, AgentSessionSummary>;
  selectAgentStudioSelection: SelectAgentStudioSelection;
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
    activeWorkspaceId,
    isRepoNavigationBoundaryPending = false,
    taskId,
    selectedTask,
    tasks,
    isLoadingTasks,
    isSessionReadModelReady,
    latestSessionByTaskId,
    activeSessionByTaskId,
    selectAgentStudioSelection,
  } = args;

  const [openTaskTabs, setOpenTaskTabs] = useState<string[]>([]);
  const [persistedActiveTaskId, setPersistedActiveTaskId] = useState<string | null>(null);
  const [loadedTabsStorageWorkspaceId, setLoadedTabsStorageWorkspaceId] = useState<string | null>(
    null,
  );

  const selectableTaskIds = useMemo(
    () =>
      new Set(
        tasks.reduce<string[]>((taskIds, task) => {
          if (
            task.status !== "closed" ||
            !isSessionReadModelReady ||
            latestSessionByTaskId.has(task.id)
          ) {
            taskIds.push(task.id);
          }
          return taskIds;
        }, []),
      ),
    [isSessionReadModelReady, latestSessionByTaskId, tasks],
  );
  const selectedTaskIsUnavailable =
    selectedTask?.status === "closed" && !selectableTaskIds.has(selectedTask.id);
  const taskIdForTabs = selectedTaskIsUnavailable ? "" : taskId;
  const selectableOpenTaskTabs = useMemo(
    () => openTaskTabs.filter((taskTabId) => selectableTaskIds.has(taskTabId)),
    [openTaskTabs, selectableTaskIds],
  );

  const selectTask = useCallback(
    (nextTaskId: string) => {
      selectAgentStudioSelection(toAgentStudioTaskSelection(nextTaskId));
    },
    [selectAgentStudioSelection],
  );

  const clearTaskSelection = useCallback((): void => {
    selectAgentStudioSelection(emptyAgentStudioSelectionState());
  }, [selectAgentStudioSelection]);
  const resetLoadedTaskTabsStorage = useCallback((): void => {
    setOpenTaskTabs([]);
    setPersistedActiveTaskId(null);
    setLoadedTabsStorageWorkspaceId(null);
  }, []);
  const applyLoadedTaskTabsStorage = useCallback(
    (tabs: string[], activeTaskId: string | null, workspaceId: string): void => {
      setOpenTaskTabs(tabs);
      setPersistedActiveTaskId(activeTaskId);
      setLoadedTabsStorageWorkspaceId(workspaceId);
    },
    [],
  );

  const { tabTaskIds, activeTaskTabId, handleSelectTab } = useTaskTabSelection({
    activeWorkspaceId,
    isRepoNavigationBoundaryPending,
    taskId: taskIdForTabs,
    openTaskTabs: selectableOpenTaskTabs,
    persistedActiveTaskId,
    loadedTabsStorageWorkspaceId,
    selectTask,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
  });

  useTaskTabPersistence({
    activeWorkspaceId,
    taskId: taskIdForTabs,
    selectedTask,
    selectableTaskIds,
    isLoadingTasks,
    openTaskTabs,
    loadedTabsStorageWorkspaceId,
    activeTaskTabId,
    setOpenTaskTabs,
    resetLoadedTaskTabsStorage,
    applyLoadedTaskTabsStorage,
  });

  const availableTabTasks = useMemo(
    () =>
      getAvailableTabTasks(
        tasks.filter((task) => task.status !== "closed" || latestSessionByTaskId.has(task.id)),
        tabTaskIds,
      ),
    [latestSessionByTaskId, tabTaskIds, tasks],
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
    clearTaskSelection,
    selectTask,
    handleSelectTab,
    setOpenTaskTabs,
    setPersistedActiveTaskId,
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
