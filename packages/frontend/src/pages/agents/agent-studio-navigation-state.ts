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
  isWorkspaceRestorePending: boolean;
  isLoadingTasks: boolean;
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
  tasks: TaskCard[];
  sessions: AgentSessionSummary[];
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectionState: AgentStudioSelectionState;
};

export const resolveAgentStudioNavigationState = ({
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
}: ResolveAgentStudioNavigationStateArgs): AgentStudioNavigationState => {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const sessionsByTaskId = groupSessionsByTaskId(sessions);
  const routeSessionResolution = resolveAgentStudioRouteSession({
    isWorkspaceRestorePending,
    isLoadingTasks,
    sessionReadModelLoadState,
    sessions,
    taskId: taskIdParam,
    sessionExternalId: sessionExternalIdParam,
    sessionIdentity:
      selectionState.taskId === taskIdParam &&
      selectionState.sessionIdentity?.externalSessionId === sessionExternalIdParam
        ? selectionState.sessionIdentity
        : null,
  });
  const selectedSessionFromRoute =
    routeSessionResolution.kind === "found" ? routeSessionResolution.session : null;
  const taskId = selectionState.taskId;
  const selectedTask = taskId ? (tasksById.get(taskId) ?? null) : null;
  const sessionsForTask = taskId ? (sessionsByTaskId.get(taskId) ?? []) : [];
  const routeTaskId = taskIdParam;
  const resolvedRouteSession = resolveRouteSession({
    isWorkspaceRestorePending,
    tasksById,
    sessionsByTaskId,
    routeTaskId,
    sessionExternalIdParam,
    routeSessionResolution,
    hasExplicitRoleParam,
    roleFromQuery,
  });
  const view = resolveNavigationViewSelection({
    routeSessionResolution,
    selectionState,
    selectedTask,
    sessionsForTask,
  });
  const queryUpdate = resolveNavigationQueryUpdate({
    isWorkspaceRestorePending,
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
  isWorkspaceRestorePending,
  tasksById,
  sessionsByTaskId,
  routeTaskId,
  sessionExternalIdParam,
  routeSessionResolution,
  hasExplicitRoleParam,
  roleFromQuery,
}: {
  isWorkspaceRestorePending: boolean;
  tasksById: Map<string, TaskCard>;
  sessionsByTaskId: Map<string, AgentSessionSummary[]>;
  routeTaskId: string;
  sessionExternalIdParam: string | null;
  routeSessionResolution: AgentStudioRouteSessionResolution;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
}): AgentSessionSummary | null => {
  if (isWorkspaceRestorePending) {
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
  selectedTask,
  sessionsForTask,
}: {
  routeSessionResolution: AgentStudioRouteSessionResolution;
  selectionState: AgentStudioSelectionState;
  selectedTask: TaskCard | null;
  sessionsForTask: AgentSessionSummary[];
}): AgentStudioNavigationViewSelection => {
  const sessionExternalId = agentStudioSelectionSessionExternalId(selectionState);
  const resolvedRouteSessionIdentity =
    routeSessionResolution.kind === "found" &&
    routeSessionResolution.session.taskId === selectionState.taskId &&
    routeSessionResolution.session.externalSessionId === sessionExternalId
      ? toAgentSessionIdentity(routeSessionResolution.session)
      : null;
  return {
    taskId: selectionState.taskId,
    selectedTask,
    sessionsForTask,
    sessionExternalId,
    sessionIdentity: selectionState.sessionIdentity ?? resolvedRouteSessionIdentity,
    role: selectionState.role,
    hasExplicitRoleSelection: selectionState.hasExplicitRoleSelection,
    keepExplicitRoleSessionless: selectionState.keepSessionless && sessionExternalId === null,
  };
};

const resolveNavigationQueryUpdate = ({
  isWorkspaceRestorePending,
  taskIdParam,
  sessionExternalIdParam,
  routeSessionResolution,
  resolvedSession,
  roleFromQuery,
  selectionState,
  hasExplicitRoleParam,
}: {
  isWorkspaceRestorePending: boolean;
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  routeSessionResolution: AgentStudioRouteSessionResolution;
  resolvedSession: AgentSessionSummary | null;
  roleFromQuery: AgentRole;
  selectionState: AgentStudioSelectionState;
  hasExplicitRoleParam: boolean;
}): AgentStudioQueryUpdate | null => {
  if (
    isWorkspaceRestorePending ||
    hasLocalSelectionAheadOfRoute({
      isWorkspaceRestorePending,
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

  const updates: AgentStudioQueryUpdate = {};

  if (sessionExternalIdParam && sessionFromQuery && resolvedSession) {
    if (roleFromQuery !== resolvedSession.role) {
      updates[AGENT_STUDIO_QUERY_KEYS.agent] = resolvedSession.role;
    }
  }

  return Object.keys(updates).length === 0 ? null : updates;
};

const hasLocalSelectionAheadOfRoute = ({
  isWorkspaceRestorePending,
  taskIdParam,
  sessionExternalIdParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectionState,
}: {
  isWorkspaceRestorePending: boolean;
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectionState: AgentStudioSelectionState;
}): boolean => {
  const routeSelection = createAgentStudioRouteSelectionState({
    isWorkspaceRestorePending,
    taskIdParam,
    sessionExternalIdParam,
    hasExplicitRoleParam,
    roleFromQuery,
  });
  return (
    agentStudioSelectionQueryKey(selectionState) !== agentStudioSelectionQueryKey(routeSelection)
  );
};
