import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { useMemo } from "react";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import { useSelectedSessionContextLoad } from "@/state/operations/agent-orchestrator/history/use-selected-session-context-load";
import { useSelectedSessionHistoryLoad } from "@/state/operations/agent-orchestrator/history/use-selected-session-history-load";
import type { RepoSettingsInput } from "@/types/state-slices";
import { resolveAgentStudioNavigationState } from "./agent-studio-navigation-state";
import { type AgentStudioRouteSessionResolution } from "./agents-page-selection";
import {
  type AgentStudioSelectedSessionView,
  useAgentStudioSelectedSessionView,
} from "./selected-session/use-agent-studio-selected-session-view";
import type { AgentStudioSelectionState } from "./shell/agent-studio-selection-state";

type UseAgentStudioSelectionControllerArgs = {
  activeWorkspaceId: string | null;
  workspaceRepoPath: string | null;
  isWorkspaceRestorePending: boolean;
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
  view: AgentStudioSelectedView;
};

export function useAgentStudioSelectionController({
  activeWorkspaceId,
  workspaceRepoPath,
  isWorkspaceRestorePending,
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
}: UseAgentStudioSelectionControllerArgs): AgentStudioSelectionControllerResult {
  const { sessionReadModelLoadState } = useAgentSessionReadModelState();

  const navigationState = useMemo(
    () =>
      resolveAgentStudioNavigationState({
        isWorkspaceRestorePending,
        isLoadingTasks,
        sessionReadModelLoadState,
        tasks,
        sessions,
        taskIdParam,
        sessionExternalIdParam,
        hasExplicitRoleParam,
        roleFromQuery,
        selectionState,
      }),
    [
      hasExplicitRoleParam,
      isLoadingTasks,
      isWorkspaceRestorePending,
      roleFromQuery,
      selectionState,
      sessionExternalIdParam,
      sessionReadModelLoadState,
      sessions,
      taskIdParam,
      tasks,
    ],
  );

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
    runtimeReadinessState: selectedSessionView.selectedSession.runtimeReadiness.state,
  });
  const contextLoadError = useSelectedSessionContextLoad({
    session: selectedSessionView.selectedSession.loadedSession,
    runtimeReadinessState: selectedSessionView.selectedSession.runtimeReadiness.state,
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
          contextError: contextLoadError,
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
      view: {
        taskId: navigationState.view.taskId,
        selectedTask: navigationState.view.selectedTask,
        sessionsForTask: navigationState.view.sessionsForTask,
        isTaskReady: isActiveTaskReady,
        ...selectedSessionViewWithContextError,
      },
    }),
    [isActiveTaskReady, navigationState, selectedSessionViewWithContextError, sessions],
  );
}
