import { useQuery } from "@tanstack/react-query";
import { taskWorkflowContextQueryOptions } from "@openducktor/frontend-core/queries/task-workflow-context";
import { useMemo } from "react";
import type { AgentSessionSummary } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { useAgentSessionReadModelState } from "@/state/app-state-provider";
import { useSelectedSessionContextLoad } from "@openducktor/frontend-core/sessions/agent-orchestrator/history/use-selected-session-context-load";
import { useSelectedSessionHistoryLoad } from "@openducktor/frontend-core/sessions/agent-orchestrator/history/use-selected-session-history-load";
import type { RepoSettingsInput } from "@/types/state-slices";
import { resolveAgentStudioNavigationState } from "./agent-studio-navigation-state";
import { type AgentStudioRouteSessionResolution } from "./agents-page-selection";
import {
  type AgentStudioSelectedSessionView,
  useAgentStudioSelectedSessionView,
} from "./selected-session/use-agent-studio-selected-session-view";
import type { AgentStudioSelectionState } from "./shell/agent-studio-selection-state";
import type {
  WorkflowRoleId as AgentRole,
  ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";

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
  roleFromQuery: AgentRole | null;
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
  const selectedTaskIsListed = tasks.some(({ id }) => id === selectionState.taskId);
  const retainedTask = useQuery({
    ...taskWorkflowContextQueryOptions(
      activeWorkspaceId && workspaceRepoPath
        ? { workspaceId: activeWorkspaceId, repoPath: workspaceRepoPath }
        : null,
      selectionState.taskId,
    ),
    enabled:
      !!workspaceRepoPath && !!selectionState.taskId && !isLoadingTasks && !selectedTaskIsListed,
  });
  const navigationTasks = useMemo(
    () => (selectedTaskIsListed || !retainedTask.data ? tasks : [...tasks, retainedTask.data]),
    [selectedTaskIsListed, retainedTask.data, tasks],
  );

  const navigationState = useMemo(
    () =>
      resolveAgentStudioNavigationState({
        isWorkspaceRestorePending,
        isLoadingTasks,
        sessionReadModelLoadState,
        tasks: navigationTasks,
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
      navigationTasks,
    ],
  );

  const selectedSessionView = useAgentStudioSelectedSessionView({
    workspaceId: activeWorkspaceId,
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
    const metadataError = !selectedTaskIsListed ? (retainedTask.error?.message ?? null) : null;
    const error = metadataError ?? contextLoadError;
    if (error === null) {
      return selectedSessionView;
    }
    return {
      ...selectedSessionView,
      selectedSession: {
        ...selectedSessionView.selectedSession,
        runtimeData: {
          ...selectedSessionView.selectedSession.runtimeData,
          contextError: error,
        },
      },
    };
  }, [contextLoadError, selectedSessionView, selectedTaskIsListed, retainedTask.error]);
  const isActiveTaskReady = Boolean(activeWorkspaceId && navigationState.view.selectedTask);

  return useMemo<AgentStudioSelectionControllerResult>(
    () => ({
      routeSessionResolution: navigationState.routeSessionResolution,
      selectedSessionFromRoute: navigationState.selectedSessionFromRoute,
      taskId: navigationState.taskId,
      selectedTask: navigationState.selectedTask,
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
    [isActiveTaskReady, navigationState, selectedSessionViewWithContextError],
  );
}
