import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import {
  type AgentStudioRouteSessionResolution,
  groupSessionsByTaskId,
  resolveAgentStudioRouteSession,
  resolveAgentStudioSessionSelection,
} from "./agents-page-selection";
import {
  AGENT_STUDIO_QUERY_KEYS,
  type AgentStudioQueryUpdate,
} from "./query-sync/agent-studio-navigation";
import {
  type AgentStudioSelectionState,
  agentStudioSelectionQueryKey,
  agentStudioSelectionSessionExternalId,
  createAgentStudioRouteSelectionState,
} from "./shell/agent-studio-selection-state";

export type AgentStudioNavigationViewSelection = {
  taskId: string;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  sessionExternalId: string | null;
  sessionIdentity: AgentSessionIdentity | null;
  role: AgentRole;
  hasExplicitRoleSelection: boolean;
  keepExplicitRoleSessionless: boolean;
};

export type AgentStudioNavigationState = {
  routeSessionResolution: AgentStudioRouteSessionResolution;
  selectedSessionFromRoute: AgentSessionSummary | null;
  taskId: string;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  resolvedRouteSession: AgentSessionSummary | null;
  view: AgentStudioNavigationViewSelection;
  queryUpdate: AgentStudioQueryUpdate | null;
};

export type ResolveAgentStudioNavigationStateArgs = {
  isRepoNavigationBoundaryPending: boolean;
  isLoadingTasks: boolean;
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  tasks: TaskCard[];
  sessions: AgentSessionSummary[];
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectionState: AgentStudioSelectionState;
  activeTaskTabId: string;
};

export const resolveAgentStudioNavigationState = ({
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
}: ResolveAgentStudioNavigationStateArgs): AgentStudioNavigationState => {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const sessionsByTaskId = groupSessionsByTaskId(sessions);
  const routeSessionResolution = resolveAgentStudioRouteSession({
    isRepoNavigationBoundaryPending,
    isLoadingTasks,
    sessionReadModelLoadState,
    sessions,
    taskId: taskIdParam,
    sessionExternalId: sessionExternalIdParam,
  });
  const selectedSessionFromRoute =
    routeSessionResolution.kind === "found" ? routeSessionResolution.session : null;
  const taskId = selectionState.taskId;
  const selectedTask = taskId ? (tasksById.get(taskId) ?? null) : null;
  const sessionsForTask = taskId ? (sessionsByTaskId.get(taskId) ?? []) : [];
  const routeTaskId = taskIdParam;
  const resolvedRouteSession = resolveRouteSession({
    isRepoNavigationBoundaryPending,
    tasksById,
    sessionsByTaskId,
    routeTaskId,
    sessionExternalIdParam,
    routeSessionResolution,
    hasExplicitRoleParam,
    roleFromQuery,
  });
  const selectedViewTaskId = activeTaskTabId || taskId;
  const selectedViewTask = selectedViewTaskId ? (tasksById.get(selectedViewTaskId) ?? null) : null;
  const selectedViewSessions = selectedViewTaskId
    ? (sessionsByTaskId.get(selectedViewTaskId) ?? [])
    : [];
  const view = resolveNavigationViewSelection({
    routeSessionResolution,
    selectionState,
    selectedTaskId: taskId,
    selectedViewTaskId,
    selectedViewTask,
    selectedViewSessions,
  });
  const queryUpdate = resolveNavigationQueryUpdate({
    isRepoNavigationBoundaryPending,
    isLoadingTasks,
    tasks,
    taskIdParam,
    sessionExternalIdParam,
    routeSessionResolution,
    resolvedSession: resolvedRouteSession,
    roleFromQuery,
    selectionState,
    hasExplicitRoleParam,
  });

  return {
    routeSessionResolution,
    selectedSessionFromRoute,
    taskId,
    selectedTask,
    sessionsForTask,
    resolvedRouteSession,
    view,
    queryUpdate,
  };
};

const resolveRouteSession = ({
  isRepoNavigationBoundaryPending,
  tasksById,
  sessionsByTaskId,
  routeTaskId,
  sessionExternalIdParam,
  routeSessionResolution,
  hasExplicitRoleParam,
  roleFromQuery,
}: {
  isRepoNavigationBoundaryPending: boolean;
  tasksById: Map<string, TaskCard>;
  sessionsByTaskId: Map<string, AgentSessionSummary[]>;
  routeTaskId: string;
  sessionExternalIdParam: string | null;
  routeSessionResolution: AgentStudioRouteSessionResolution;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
}): AgentSessionSummary | null => {
  if (isRepoNavigationBoundaryPending) {
    return null;
  }

  if (sessionExternalIdParam) {
    return routeSessionResolution.kind === "found" ? routeSessionResolution.session : null;
  }

  const routeSelectedTask = routeTaskId ? (tasksById.get(routeTaskId) ?? null) : null;
  const routeSessionsForTask = routeTaskId ? (sessionsByTaskId.get(routeTaskId) ?? []) : [];
  return resolveAgentStudioSessionSelection({
    sessionsForTask: routeSessionsForTask,
    sessionExternalId: null,
    hasExplicitRoleParam,
    roleFromQuery,
    selectedTask: routeSelectedTask,
    sessionlessRole: roleFromQuery,
  }).sessionSummary;
};

const resolveNavigationViewSelection = ({
  routeSessionResolution,
  selectionState,
  selectedTaskId,
  selectedViewTaskId,
  selectedViewTask,
  selectedViewSessions,
}: {
  routeSessionResolution: AgentStudioRouteSessionResolution;
  selectionState: AgentStudioSelectionState;
  selectedTaskId: string;
  selectedViewTaskId: string;
  selectedViewTask: TaskCard | null;
  selectedViewSessions: AgentSessionSummary[];
}): AgentStudioNavigationViewSelection => {
  const selectionSessionExternalId = agentStudioSelectionSessionExternalId(selectionState);
  const isDetachedFromSelectedTask = Boolean(
    selectedViewTaskId && selectedTaskId && selectedViewTaskId !== selectedTaskId,
  );
  const sessionExternalId = isDetachedFromSelectedTask ? null : selectionSessionExternalId;
  const resolvedRouteSessionIdentity =
    routeSessionResolution.kind === "found" &&
    routeSessionResolution.session.taskId === selectionState.taskId &&
    routeSessionResolution.session.externalSessionId === selectionSessionExternalId
      ? toAgentSessionIdentity(routeSessionResolution.session)
      : null;
  const sessionIdentity = isDetachedFromSelectedTask
    ? null
    : (resolvedRouteSessionIdentity ?? selectionState.sessionIdentity);
  const role = isDetachedFromSelectedTask ? "spec" : selectionState.role;
  const hasExplicitRoleSelection =
    !isDetachedFromSelectedTask && selectionState.hasExplicitRoleSelection;

  return {
    taskId: selectedViewTaskId,
    selectedTask: selectedViewTask,
    sessionsForTask: selectedViewSessions,
    sessionExternalId,
    sessionIdentity,
    role,
    hasExplicitRoleSelection,
    keepExplicitRoleSessionless:
      !isDetachedFromSelectedTask && selectionState.keepSessionless && sessionExternalId === null,
  };
};

const resolveNavigationQueryUpdate = ({
  isRepoNavigationBoundaryPending,
  isLoadingTasks,
  tasks,
  taskIdParam,
  sessionExternalIdParam,
  routeSessionResolution,
  resolvedSession,
  roleFromQuery,
  selectionState,
  hasExplicitRoleParam,
}: {
  isRepoNavigationBoundaryPending: boolean;
  isLoadingTasks: boolean;
  tasks: TaskCard[];
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  routeSessionResolution: AgentStudioRouteSessionResolution;
  resolvedSession: AgentSessionSummary | null;
  roleFromQuery: AgentRole;
  selectionState: AgentStudioSelectionState;
  hasExplicitRoleParam: boolean;
}): AgentStudioQueryUpdate | null => {
  if (
    isRepoNavigationBoundaryPending ||
    hasLocalSelectionAheadOfRoute({
      isRepoNavigationBoundaryPending,
      taskIdParam,
      sessionExternalIdParam,
      hasExplicitRoleParam,
      roleFromQuery,
      selectionState,
    })
  ) {
    return null;
  }

  const sessionFromQuery =
    routeSessionResolution.kind === "found" ? routeSessionResolution.session : null;

  if (
    !isLoadingTasks &&
    taskIdParam &&
    !sessionExternalIdParam &&
    !sessionFromQuery &&
    !tasks.some((entry) => entry.id === taskIdParam)
  ) {
    return clearAgentStudioRouteSelection();
  }

  const updates: AgentStudioQueryUpdate = {};

  if (sessionExternalIdParam && sessionFromQuery && resolvedSession) {
    if (roleFromQuery !== resolvedSession.role) {
      updates[AGENT_STUDIO_QUERY_KEYS.agent] = resolvedSession.role;
    }
  }

  return Object.keys(updates).length === 0 ? null : updates;
};

const hasLocalSelectionAheadOfRoute = ({
  isRepoNavigationBoundaryPending,
  taskIdParam,
  sessionExternalIdParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectionState,
}: {
  isRepoNavigationBoundaryPending: boolean;
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectionState: AgentStudioSelectionState;
}): boolean => {
  const routeSelection = createAgentStudioRouteSelectionState({
    isRepoNavigationBoundaryPending,
    taskIdParam,
    sessionExternalIdParam,
    hasExplicitRoleParam,
    roleFromQuery,
  });
  return (
    agentStudioSelectionQueryKey(selectionState) !== agentStudioSelectionQueryKey(routeSelection)
  );
};

const clearAgentStudioRouteSelection = (): AgentStudioQueryUpdate => ({
  [AGENT_STUDIO_QUERY_KEYS.task]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.session]: undefined,
  [AGENT_STUDIO_QUERY_KEYS.agent]: undefined,
});
