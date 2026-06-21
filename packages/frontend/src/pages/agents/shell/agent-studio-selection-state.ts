import type { AgentRole } from "@openducktor/core";
import {
  agentSessionIdentityKey,
  parseAgentSessionIdentityKey,
  toAgentSessionIdentity,
} from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  AGENT_STUDIO_QUERY_KEYS,
  type AgentStudioQueryUpdate,
} from "../query-sync/agent-studio-navigation";

export type AgentStudioSelectionState = {
  taskId: string;
  sessionIdentity: AgentSessionIdentity | null;
  role: AgentRole;
  hasExplicitRoleSelection: boolean;
  keepSessionless: boolean;
};

export type SelectAgentStudioSelection = (selection: AgentStudioSelectionState) => void;

export const emptyAgentStudioSelectionState = (): AgentStudioSelectionState => ({
  taskId: "",
  sessionIdentity: null,
  role: "spec",
  hasExplicitRoleSelection: false,
  keepSessionless: false,
});

export const agentStudioSelectionSessionKey = (
  selection: AgentStudioSelectionState,
): string | null =>
  selection.sessionIdentity ? agentSessionIdentityKey(selection.sessionIdentity) : null;

export const agentStudioSelectionQueryKey = (selection: AgentStudioSelectionState): string =>
  [
    selection.taskId,
    agentStudioSelectionSessionKey(selection) ?? "",
    selection.hasExplicitRoleSelection ? selection.role : "",
    selection.hasExplicitRoleSelection ? "role:explicit" : "role:derived",
  ].join("\u001f");

export const createAgentStudioRouteSelectionState = ({
  isRepoNavigationBoundaryPending,
  taskIdParam,
  sessionKeyParam,
  hasExplicitRoleParam,
  roleFromQuery,
}: {
  isRepoNavigationBoundaryPending: boolean;
  taskIdParam: string;
  sessionKeyParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
}): AgentStudioSelectionState => {
  if (isRepoNavigationBoundaryPending) {
    return emptyAgentStudioSelectionState();
  }

  return {
    taskId: taskIdParam,
    sessionIdentity: parseAgentSessionIdentityKey(sessionKeyParam),
    role: roleFromQuery,
    hasExplicitRoleSelection: hasExplicitRoleParam,
    keepSessionless: false,
  };
};

export const toAgentStudioTaskSelection = (taskId: string): AgentStudioSelectionState => ({
  taskId,
  sessionIdentity: null,
  role: "spec",
  hasExplicitRoleSelection: false,
  keepSessionless: false,
});

export const toAgentStudioSessionSelection = (
  session: AgentSessionIdentity & { taskId: string; role: AgentRole },
): AgentStudioSelectionState => ({
  taskId: session.taskId,
  sessionIdentity: toAgentSessionIdentity(session),
  role: session.role,
  hasExplicitRoleSelection: true,
  keepSessionless: false,
});

export const toAgentStudioSessionlessRoleSelection = ({
  taskId,
  role,
}: {
  taskId: string;
  role: AgentRole;
}): AgentStudioSelectionState => ({
  taskId,
  sessionIdentity: null,
  role,
  hasExplicitRoleSelection: true,
  keepSessionless: true,
});

export const buildAgentStudioSelectionQueryUpdateFromState = (
  selection: AgentStudioSelectionState,
): AgentStudioQueryUpdate => ({
  [AGENT_STUDIO_QUERY_KEYS.task]: selection.taskId || undefined,
  [AGENT_STUDIO_QUERY_KEYS.session]: agentStudioSelectionSessionKey(selection) ?? undefined,
  [AGENT_STUDIO_QUERY_KEYS.agent]: selection.hasExplicitRoleSelection ? selection.role : undefined,
});
