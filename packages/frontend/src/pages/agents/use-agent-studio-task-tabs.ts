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
  agentStudioStateLoadKey: string | null;
  agentStudioState: WorkspaceAgentStudioState | null;
  isWorkspaceRestorePending?: boolean;
  taskId: string;
  routeTaskId: string;
  selectedTask: TaskCard | null;
  tasks: TaskCard[];
  tasksAreCurrent: boolean;
  latestSessionByTaskId: Map<string, AgentSessionSummary>;
  activeSessionByTaskId?: Map<string, AgentSessionSummary>;
  selectAgentStudioSelection: SelectAgentStudioSelection;
}) {
  const {
    activeWorkspaceId,
    loadedAgentStudioState,
    agentStudioStateLoadKey,
    agentStudioState,
    isWorkspaceRestorePending = false,
    taskId,
    routeTaskId,
    selectedTask,
    tasks,
    tasksAreCurrent,
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
  const { openTaskIds, persistedActiveTaskId, loadedStateWorkspaceId, setTabState } =
    useTaskTabState({
      activeWorkspaceId,
      loadedAgentStudioState,
      agentStudioStateLoadKey,
      agentStudioState,
      taskId: taskIdForTabs,
      selectedTask,
      tasks,
      tasksAreCurrent,
    });

  const { tabTaskIds, activeTaskTabId, handleSelectTab } = useTaskTabSelection({
    activeWorkspaceId,
    isWorkspaceRestorePending,
    taskId: taskIdForTabs,
    routeTaskId,
    tabTaskIds: openTaskIds,
    persistedActiveTaskId,
    loadedStateWorkspaceId,
    selectTask,
    setTaskTabState: setTabState,
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
    setTaskTabState: setTabState,
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
