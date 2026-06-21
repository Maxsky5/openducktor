import type { TaskCard } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import {
  type AgentStudioRouteSessionResolution,
  findAgentStudioSessionSummaryByKey,
  groupSessionsByTaskId,
  resolveAgentStudioRouteSession,
  resolveAgentStudioSessionSelection,
  resolveAgentStudioTaskId,
} from "./agents-page-selection";
import {
  AGENT_STUDIO_QUERY_KEYS,
  type AgentStudioQueryUpdate,
} from "./query-sync/agent-studio-navigation";
import {
  type AgentStudioSelectionState,
  agentStudioSelectionQueryKey,
  agentStudioSelectionSessionKey,
  createAgentStudioRouteSelectionState,
} from "./shell/agent-studio-selection-state";

export type AgentStudioNavigationViewSelection = {
  taskId: string;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
  sessionKey: string | null;
  sessionIdentity: AgentSessionIdentity | null;
  role: AgentRole;
  hasExplicitRoleSelection: boolean;
  keepExplicitRoleSessionless: boolean;
};

export type AgentStudioNavigationState = {
  routeSessionResolution: AgentStudioRouteSessionResolution;
  selectedSessionFromRoute: AgentSessionSummary | null;
  selectedSessionFromSelection: AgentSessionSummary | null;
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
  sessionKeyParam: string | null;
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
  sessionKeyParam,
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
    sessionKey: sessionKeyParam,
  });
  const selectedSessionFromRoute =
    routeSessionResolution.kind === "found" ? routeSessionResolution.session : null;
  const selectedSessionFromSelection = findAgentStudioSessionSummaryByKey(
    sessions,
    agentStudioSelectionSessionKey(selectionState),
  );
  const taskId = resolveAgentStudioTaskId({
    taskIdParam: selectionState.taskId,
    selectedSessionFromRoute: selectedSessionFromSelection,
  });
  const selectedTask = taskId ? (tasksById.get(taskId) ?? null) : null;
  const sessionsForTask = taskId ? (sessionsByTaskId.get(taskId) ?? []) : [];
  const routeTaskId = resolveAgentStudioTaskId({
    taskIdParam,
    selectedSessionFromRoute,
  });
  const resolvedRouteSession = resolveRouteSession({
    isRepoNavigationBoundaryPending,
    tasksById,
    sessionsByTaskId,
    routeTaskId,
    sessionKeyParam,
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
    sessionKeyParam,
    routeSessionResolution,
    routeTaskId,
    resolvedSession: resolvedRouteSession,
    roleFromQuery,
    selectionState,
    hasExplicitRoleParam,
  });

  return {
    routeSessionResolution,
    selectedSessionFromRoute,
    selectedSessionFromSelection,
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
  sessionKeyParam,
  hasExplicitRoleParam,
  roleFromQuery,
}: {
  isRepoNavigationBoundaryPending: boolean;
  tasksById: Map<string, TaskCard>;
  sessionsByTaskId: Map<string, AgentSessionSummary[]>;
  routeTaskId: string;
  sessionKeyParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
}): AgentSessionSummary | null => {
  if (isRepoNavigationBoundaryPending) {
    return null;
  }

  const routeSelectedTask = routeTaskId ? (tasksById.get(routeTaskId) ?? null) : null;
  const routeSessionsForTask = routeTaskId ? (sessionsByTaskId.get(routeTaskId) ?? []) : [];
  return resolveAgentStudioSessionSelection({
    sessionsForTask: routeSessionsForTask,
    sessionKey: sessionKeyParam,
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
  const selectionSessionKey = agentStudioSelectionSessionKey(selectionState);
  const isDetachedFromSelectedTask = Boolean(
    selectedViewTaskId && selectedTaskId && selectedViewTaskId !== selectedTaskId,
  );
  const hasMissingRouteSessionSelection =
    routeSessionResolution.kind === "missing" &&
    selectionSessionKey === routeSessionResolution.sessionKey;
  const sessionKey =
    isDetachedFromSelectedTask || hasMissingRouteSessionSelection ? null : selectionSessionKey;
  const sessionIdentity =
    isDetachedFromSelectedTask || hasMissingRouteSessionSelection
      ? null
      : selectionState.sessionIdentity;
  const role = isDetachedFromSelectedTask ? "spec" : selectionState.role;
  const hasExplicitRoleSelection =
    !isDetachedFromSelectedTask && selectionState.hasExplicitRoleSelection;

  return {
    taskId: selectedViewTaskId,
    selectedTask: selectedViewTask,
    sessionsForTask: selectedViewSessions,
    sessionKey,
    sessionIdentity,
    role,
    hasExplicitRoleSelection,
    keepExplicitRoleSessionless:
      !isDetachedFromSelectedTask && selectionState.keepSessionless && sessionKey === null,
  };
};

const resolveNavigationQueryUpdate = ({
  isRepoNavigationBoundaryPending,
  isLoadingTasks,
  tasks,
  taskIdParam,
  sessionKeyParam,
  routeSessionResolution,
  routeTaskId,
  resolvedSession,
  roleFromQuery,
  selectionState,
  hasExplicitRoleParam,
}: {
  isRepoNavigationBoundaryPending: boolean;
  isLoadingTasks: boolean;
  tasks: TaskCard[];
  taskIdParam: string;
  sessionKeyParam: string | null;
  routeSessionResolution: AgentStudioRouteSessionResolution;
  routeTaskId: string;
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
      sessionKeyParam,
      hasExplicitRoleParam,
      roleFromQuery,
      selectionState,
    })
  ) {
    return null;
  }

  const sessionFromQuery =
    routeSessionResolution.kind === "found" ? routeSessionResolution.session : null;
  const isMissingRouteSession = routeSessionResolution.kind === "missing";

  if (
    !isLoadingTasks &&
    taskIdParam &&
    !sessionKeyParam &&
    !sessionFromQuery &&
    !tasks.some((entry) => entry.id === taskIdParam)
  ) {
    return clearAgentStudioRouteSelection();
  }

  const updates: AgentStudioQueryUpdate = {};

  if (sessionFromQuery && !taskIdParam) {
    updates[AGENT_STUDIO_QUERY_KEYS.task] = sessionFromQuery.taskId;
  }

  const routeTaskExists = routeTaskId.length > 0 && tasks.some((entry) => entry.id === routeTaskId);
  if (sessionKeyParam && isMissingRouteSession && taskIdParam && !routeTaskExists) {
    return clearAgentStudioRouteSelection();
  }
  const shouldClearSessionKey = Boolean(sessionKeyParam) && isMissingRouteSession;

  if (sessionKeyParam) {
    if (sessionFromQuery && routeTaskId && sessionFromQuery.taskId !== routeTaskId) {
      updates[AGENT_STUDIO_QUERY_KEYS.task] = sessionFromQuery.taskId;
    } else if (shouldClearSessionKey) {
      updates[AGENT_STUDIO_QUERY_KEYS.session] = undefined;
    }
  }

  if (sessionKeyParam && !shouldClearSessionKey && resolvedSession) {
    if (taskIdParam !== resolvedSession.taskId) {
      updates[AGENT_STUDIO_QUERY_KEYS.task] = resolvedSession.taskId;
    }
    const resolvedSessionKey = agentSessionIdentityKey(resolvedSession);
    if (sessionKeyParam !== resolvedSessionKey) {
      updates[AGENT_STUDIO_QUERY_KEYS.session] = resolvedSessionKey;
    }
    if (roleFromQuery !== resolvedSession.role) {
      updates[AGENT_STUDIO_QUERY_KEYS.agent] = resolvedSession.role;
    }
  }

  return Object.keys(updates).length === 0 ? null : updates;
};

const hasLocalSelectionAheadOfRoute = ({
  isRepoNavigationBoundaryPending,
  taskIdParam,
  sessionKeyParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectionState,
}: {
  isRepoNavigationBoundaryPending: boolean;
  taskIdParam: string;
  sessionKeyParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectionState: AgentStudioSelectionState;
}): boolean => {
  const routeSelection = createAgentStudioRouteSelectionState({
    isRepoNavigationBoundaryPending,
    taskIdParam,
    sessionKeyParam,
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
