import type { AgentRole } from "@openducktor/core";
import {
  agentSessionIdentityKey,
  parseAgentSessionIdentityKey,
} from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentStudioSelectionIntent } from "./agent-studio-selection-intent";

export type AgentStudioSelectionBaseParams = {
  taskIdParam: string;
  sessionKeyParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  selectionIntent: AgentStudioSelectionIntent | null;
};

export type AgentStudioRouteSelectionParams = {
  taskIdParam: string;
  sessionKeyParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
  keepExplicitRoleSessionless: boolean;
};

export type AgentStudioViewSelectionParams = {
  sessionKeyParam: string | null;
  sessionIdentity: AgentSessionIdentity | null;
  hasExplicitRoleSelection: boolean;
  roleSelection: AgentRole;
  sessionlessRole: AgentRole;
  keepExplicitRoleSessionless: boolean;
  selectionIntent: AgentStudioSelectionIntent | null;
};

export const resolveAgentStudioSelectionBaseParams = ({
  isRepoNavigationBoundaryPending,
  taskIdParam,
  sessionKeyParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectionIntent,
}: AgentStudioSelectionBaseParams & {
  isRepoNavigationBoundaryPending: boolean;
}): AgentStudioSelectionBaseParams => {
  if (isRepoNavigationBoundaryPending) {
    return {
      taskIdParam: "",
      sessionKeyParam: null,
      hasExplicitRoleParam: false,
      roleFromQuery: "spec",
      selectionIntent: null,
    };
  }

  return {
    taskIdParam,
    sessionKeyParam,
    hasExplicitRoleParam,
    roleFromQuery,
    selectionIntent,
  };
};

export const resolveAgentStudioRouteSelectionParams = ({
  taskIdParam,
  sessionKeyParam,
  hasExplicitRoleParam,
  roleFromQuery,
  selectionIntent,
}: AgentStudioSelectionBaseParams): AgentStudioRouteSelectionParams => ({
  taskIdParam: selectionIntent?.taskId ?? taskIdParam,
  sessionKeyParam: selectionIntent?.sessionIdentity
    ? agentSessionIdentityKey(selectionIntent.sessionIdentity)
    : sessionKeyParam,
  hasExplicitRoleParam: selectionIntent !== null ? true : hasExplicitRoleParam,
  roleFromQuery: selectionIntent?.role ?? roleFromQuery,
  keepExplicitRoleSessionless:
    selectionIntent?.sessionIdentity === null && sessionKeyParam === null,
});

export const resolveAgentStudioViewSelectionParams = ({
  baseParams,
  routeTaskId,
  viewTaskId,
}: {
  baseParams: AgentStudioSelectionBaseParams;
  routeTaskId: string;
  viewTaskId: string;
}): AgentStudioViewSelectionParams => {
  const isDetachedFromRoute = Boolean(viewTaskId && routeTaskId && viewTaskId !== routeTaskId);
  const selectionIntent =
    baseParams.selectionIntent &&
    baseParams.selectionIntent.taskId === viewTaskId &&
    (baseParams.selectionIntent.sessionIdentity !== null || baseParams.sessionKeyParam === null)
      ? baseParams.selectionIntent
      : null;
  const sessionKeyParam = (() => {
    if (selectionIntent?.sessionIdentity) {
      return agentSessionIdentityKey(selectionIntent.sessionIdentity);
    }
    if (isDetachedFromRoute) {
      return null;
    }
    return baseParams.sessionKeyParam;
  })();

  return {
    sessionKeyParam,
    sessionIdentity:
      selectionIntent?.sessionIdentity ?? parseAgentSessionIdentityKey(sessionKeyParam),
    hasExplicitRoleSelection:
      selectionIntent !== null ? true : baseParams.hasExplicitRoleParam && !isDetachedFromRoute,
    roleSelection: selectionIntent?.role ?? baseParams.roleFromQuery,
    sessionlessRole: isDetachedFromRoute
      ? "spec"
      : (selectionIntent?.role ?? baseParams.roleFromQuery),
    keepExplicitRoleSessionless:
      selectionIntent?.sessionIdentity === null && baseParams.sessionKeyParam === null,
    selectionIntent,
  };
};
