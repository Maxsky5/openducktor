import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import { isAgentSessionActivityActive } from "@/lib/agent-session-activity-state";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import { useSelectedSessionContextLoad } from "@/state/operations/agent-orchestrator/history/use-selected-session-context-load";
import { useSelectedSessionHistoryLoad } from "@/state/operations/agent-orchestrator/history/use-selected-session-history-load";
import type { RepoSettingsInput } from "@/types/state-slices";
import { resolveAgentStudioNavigationState } from "./agent-studio-navigation-state";
import {
  type AgentStudioRouteSessionResolution,
  groupSessionsByTaskId,
} from "./agents-page-selection";
import {
  type AgentStudioSelectedSessionView,
  useAgentStudioSelectedSessionView,
} from "./selected-session/use-agent-studio-selected-session-view";
import type {
  AgentStudioSelectionState,
  SelectAgentStudioSelection,
} from "./shell/agent-studio-selection-state";
import { useAgentStudioTaskTabs } from "./use-agent-studio-task-tabs";

type UseAgentStudioSelectionControllerArgs = {
  activeWorkspaceId: string | null;
  workspaceRepoPath: string | null;
  isRepoNavigationBoundaryPending: boolean;
  tasks: TaskCard[];
  isLoadingTasks: boolean;
  sessions: AgentSessionSummary[];
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectionState: AgentStudioSelectionState;
  repoSettings: RepoSettingsInput | null;
  isLoadingRepoSettings: boolean;
  selectAgentStudioSelection: SelectAgentStudioSelection;
};

export type AgentStudioSelectedView = {
  taskId: string;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  isTaskReady: boolean;
} & AgentStudioSelectedSessionView;

export type AgentStudioSelectionControllerResult = {
  routeSessionResolution: AgentStudioRouteSessionResolution;
  selectedSessionFromRoute: AgentSessionSummary | null;
  taskId: string;
  selectedTask: TaskCard | null;
  allSessionSummaries: AgentSessionSummary[];
  sessionsForTask: AgentSessionSummary[];
  resolvedRouteSession: AgentSessionSummary | null;
  queryUpdate: ReturnType<typeof resolveAgentStudioNavigationState>["queryUpdate"];
  isLoadingTasks: boolean;
  activeTaskTabId: string;
  availableTabTasks: TaskCard[];
  taskTabs: ReturnType<typeof useAgentStudioTaskTabs>["taskTabs"];
  handleSelectTab: (nextTaskId: string) => void;
  handleCreateTab: (nextTaskId: string) => void;
  handleCloseTab: (taskIdToClose: string) => void;
  handleReorderTab: (
    draggedTaskId: string,
    targetTaskId: string,
    position: "before" | "after",
  ) => void;
  view: AgentStudioSelectedView;
};

export function useAgentStudioSelectionController({
  activeWorkspaceId,
  workspaceRepoPath,
  isRepoNavigationBoundaryPending,
  tasks,
  isLoadingTasks,
  sessions,
  taskIdParam,
  sessionExternalIdParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectionState,
  repoSettings,
  isLoadingRepoSettings,
  selectAgentStudioSelection,
}: UseAgentStudioSelectionControllerArgs): AgentStudioSelectionControllerResult {
  const { sessionReadModelLoadState } = useAgentSessionReadModelState();

  const sessionsByTaskId = useMemo(() => groupSessionsByTaskId(sessions), [sessions]);

  const navigationBase = useMemo(
    () =>
      resolveAgentStudioNavigationState({
        isRepoNavigationBoundaryPending,
        isLoadingTasks,
        sessionReadModelLoadState,
        tasks,
        sessions,
        taskIdParam,
        sessionExternalIdParam,
        hasExplicitRoleParam,
        roleFromQuery,
        selectionState,
        activeTaskTabId: "",
      }),
    [
      hasExplicitRoleParam,
      isLoadingTasks,
      isRepoNavigationBoundaryPending,
      roleFromQuery,
      selectionState,
      sessionExternalIdParam,
      sessionReadModelLoadState,
      sessions,
      taskIdParam,
      tasks,
    ],
  );

  const latestSessionByTaskId = useMemo(() => {
    const latestByTask = new Map<string, AgentSessionSummary>();
    for (const [taskKey, taskSessions] of sessionsByTaskId) {
      const latestSession = taskSessions[0];
      if (latestSession) {
        latestByTask.set(taskKey, latestSession);
      }
    }
    return latestByTask;
  }, [sessionsByTaskId]);

  const activeSessionByTaskId = useMemo(() => {
    const activeByTask = new Map<string, AgentSessionSummary>();
    for (const [taskKey, taskSessions] of sessionsByTaskId) {
      let activeSession: AgentSessionSummary | null = null;
      for (const session of taskSessions) {
        if (isAgentSessionActivityActive(session.activityState)) {
          activeSession = session;
          break;
        }
      }
      if (activeSession) {
        activeByTask.set(taskKey, activeSession);
      }
    }
    return activeByTask;
  }, [sessionsByTaskId]);

  const {
    activeTaskTabId,
    availableTabTasks,
    taskTabs,
    handleSelectTab,
    handleCreateTab,
    handleCloseTab,
    handleReorderTab,
  } = useAgentStudioTaskTabs({
    activeWorkspaceId,
    isRepoNavigationBoundaryPending,
    taskId: navigationBase.taskId,
    selectedTask: navigationBase.selectedTask,
    tasks,
    isLoadingTasks,
    latestSessionByTaskId,
    activeSessionByTaskId,
    selectAgentStudioSelection,
  });

  const navigationState = useMemo(() => {
    if (!activeTaskTabId || activeTaskTabId === navigationBase.taskId) {
      return navigationBase;
    }
    return resolveAgentStudioNavigationState({
      isRepoNavigationBoundaryPending,
      isLoadingTasks,
      sessionReadModelLoadState,
      tasks,
      sessions,
      taskIdParam,
      sessionExternalIdParam,
      hasExplicitRoleParam,
      roleFromQuery,
      selectionState,
      activeTaskTabId,
    });
  }, [
    activeTaskTabId,
    hasExplicitRoleParam,
    isLoadingTasks,
    isRepoNavigationBoundaryPending,
    navigationBase,
    roleFromQuery,
    selectionState,
    sessionExternalIdParam,
    sessionReadModelLoadState,
    sessions,
    taskIdParam,
    tasks,
  ]);

  const selectedSessionView = useAgentStudioSelectedSessionView({
    workspaceRepoPath,
    selectedTask: navigationState.view.selectedTask,
    sessionSummaries: navigationState.view.sessionsForTask,
    sessionExternalId: navigationState.view.sessionExternalId,
    routeSessionResolution: navigationState.routeSessionResolution,
    hasExplicitRoleSelection: navigationState.view.hasExplicitRoleSelection,
    roleSelection: navigationState.view.role,
    sessionlessRole: navigationState.view.role,
    keepExplicitRoleSessionless: navigationState.view.keepExplicitRoleSessionless,
    sessionIdentityFromRoute: navigationState.view.sessionIdentity,
    repoSettings,
    isLoadingRepoSettings,
  });
  useSelectedSessionHistoryLoad({
    session: selectedSessionView.selectedSession.loadedSession,
    repoReadinessState: selectedSessionView.selectedSession.runtimeReadiness.state,
  });
  const contextLoadError = useSelectedSessionContextLoad({
    session: selectedSessionView.selectedSession.loadedSession,
    repoReadinessState: selectedSessionView.selectedSession.runtimeReadiness.state,
  });
  const selectedSessionViewWithContextError = useMemo<AgentStudioSelectedSessionView>(() => {
    if (contextLoadError === null) {
      return selectedSessionView;
    }
    return {
      ...selectedSessionView,
      selectedSession: {
        ...selectedSessionView.selectedSession,
        runtimeData: {
          ...selectedSessionView.selectedSession.runtimeData,
          error: contextLoadError,
        },
      },
    };
  }, [contextLoadError, selectedSessionView]);
  const isActiveTaskReady = Boolean(activeWorkspaceId && navigationState.view.taskId);

  return useMemo<AgentStudioSelectionControllerResult>(
    () => ({
      routeSessionResolution: navigationState.routeSessionResolution,
      selectedSessionFromRoute: navigationState.selectedSessionFromRoute,
      taskId: navigationState.taskId,
      selectedTask: navigationState.selectedTask,
      allSessionSummaries: sessions,
      sessionsForTask: navigationState.sessionsForTask,
      resolvedRouteSession: navigationState.resolvedRouteSession,
      queryUpdate: navigationState.queryUpdate,
      isLoadingTasks,
      activeTaskTabId,
      availableTabTasks,
      taskTabs,
      handleSelectTab,
      handleCreateTab,
      handleCloseTab,
      handleReorderTab,
      view: {
        taskId: navigationState.view.taskId,
        selectedTask: navigationState.view.selectedTask,
        sessionsForTask: navigationState.view.sessionsForTask,
        isTaskReady: isActiveTaskReady,
        ...selectedSessionViewWithContextError,
      },
    }),
    [
      activeTaskTabId,
      availableTabTasks,
      handleCloseTab,
      handleCreateTab,
      handleReorderTab,
      handleSelectTab,
      isActiveTaskReady,
      isLoadingTasks,
      navigationState,
      selectedSessionViewWithContextError,
      sessions,
      taskTabs,
    ],
  );
}
