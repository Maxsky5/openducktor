import type { TaskCard, WorkspaceAgentStudioState } from "@openducktor/contracts";
import { useCallback, useMemo } from "react";
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
import { useTaskTabSelection } from "./use-agent-studio-task-tabs-selection";
import { useTaskTabState } from "./use-agent-studio-task-tabs-state";

export function useAgentStudioTaskTabs(args: {
  activeWorkspaceId: string | null;
  loadedAgentStudioState: WorkspaceAgentStudioState | null;
  loadedAgentStudioStateVersion: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  isRepoNavigationBoundaryPending?: boolean;
  taskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  latestSessionByTaskId: Map<string, AgentSessionSummary>;
  activeSessionByTaskId?: Map<string, AgentSessionSummary>;
  selectAgentStudioSelection: SelectAgentStudioSelection;
}) {
  const {
    activeWorkspaceId,
    loadedAgentStudioState,
    loadedAgentStudioStateVersion,
    agentStudioState,
    isRepoNavigationBoundaryPending = false,
    taskId,
    selectedTask,
    tasks,
    isLoadingTasks,
    latestSessionByTaskId,
    activeSessionByTaskId,
    selectAgentStudioSelection,
  } = args;

  const taskIdForTabs = selectedTask?.status === "closed" ? "" : taskId;

  const selectTask = useCallback(
    (nextTaskId: string) => {
      selectAgentStudioSelection(toAgentStudioTaskSelection(nextTaskId));
    },
    [selectAgentStudioSelection],
  );

  const clearTaskSelection = useCallback((): void => {
    selectAgentStudioSelection(emptyAgentStudioSelectionState());
  }, [selectAgentStudioSelection]);
  const { openTaskIds, persistedActiveTaskId, loadedStateWorkspaceId, updateState } =
    useTaskTabState({
      activeWorkspaceId,
      loadedAgentStudioState,
      loadedAgentStudioStateVersion,
      agentStudioState,
      taskId: taskIdForTabs,
      selectedTask,
      tasks,
      isLoadingTasks,
    });

  const { tabTaskIds, activeTaskTabId, handleSelectTab } = useTaskTabSelection({
    activeWorkspaceId,
    isRepoNavigationBoundaryPending,
    taskId: taskIdForTabs,
    tabTaskIds: openTaskIds,
    persistedActiveTaskId,
    loadedStateWorkspaceId,
    selectTask,
    updateTaskTabState: updateState,
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
    clearTaskSelection,
    selectTask,
    handleSelectTab,
    updateTaskTabState: updateState,
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
    loadedStateWorkspaceId,
  } satisfies {
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
    loadedStateWorkspaceId: string | null;
  };
}
