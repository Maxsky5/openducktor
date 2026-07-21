import type { AgentRole } from "@openducktor/core";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import {
  AGENT_STUDIO_QUERY_KEYS,
  type AgentStudioQueryUpdate,
} from "../query-sync/agent-studio-navigation";

export type AgentStudioSelectionState = {
  taskId: string;
  sessionExternalId: string | null;
  sessionIdentity: AgentSessionIdentity | null;
  role: AgentRole;
  hasExplicitRoleSelection: boolean;
  keepSessionless: boolean;
};

export type SelectAgentStudioSelection = (selection: AgentStudioSelectionState) => void;

export const emptyAgentStudioSelectionState = (): AgentStudioSelectionState => ({
  taskId: "",
  sessionExternalId: null,
  sessionIdentity: null,
  role: "spec",
  hasExplicitRoleSelection: false,
  keepSessionless: false,
});

export const agentStudioSelectionSessionExternalId = (
  selection: AgentStudioSelectionState,
): string | null => selection.sessionIdentity?.externalSessionId ?? selection.sessionExternalId;

export const agentStudioSelectionQueryKey = (selection: AgentStudioSelectionState): string =>
  [
    selection.taskId,
    agentStudioSelectionSessionExternalId(selection) ?? "",
    selection.hasExplicitRoleSelection ? selection.role : "",
    selection.hasExplicitRoleSelection ? "role:explicit" : "role:derived",
  ].join("\u001f");

export const createAgentStudioRouteSelectionState = ({
  isRepoNavigationBoundaryPending,
  taskIdParam,
  sessionExternalIdParam,
  hasExplicitRoleParam,
  roleFromQuery,
}: {
  isRepoNavigationBoundaryPending: boolean;
  taskIdParam: string;
  sessionExternalIdParam: string | null;
  hasExplicitRoleParam: boolean;
  roleFromQuery: AgentRole;
}): AgentStudioSelectionState => {
  if (isRepoNavigationBoundaryPending) {
    return emptyAgentStudioSelectionState();
  }

  return {
    taskId: taskIdParam,
    sessionExternalId: sessionExternalIdParam,
    sessionIdentity: null,
    role: roleFromQuery,
    hasExplicitRoleSelection: hasExplicitRoleParam,
    keepSessionless: false,
  };
};

export const toAgentStudioTaskSelection = (taskId: string): AgentStudioSelectionState => ({
  taskId,
  sessionExternalId: null,
  sessionIdentity: null,
  role: "spec",
  hasExplicitRoleSelection: false,
  keepSessionless: false,
});

export const toAgentStudioSessionSelection = (
  session: AgentSessionIdentity & { taskId: string; role: AgentRole },
): AgentStudioSelectionState => ({
  taskId: session.taskId,
  sessionExternalId: session.externalSessionId,
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
  sessionExternalId: null,
  sessionIdentity: null,
  role,
  hasExplicitRoleSelection: true,
  keepSessionless: true,
});

export const buildAgentStudioSelectionQueryUpdateFromState = (
  selection: AgentStudioSelectionState,
): AgentStudioQueryUpdate => ({
  [AGENT_STUDIO_QUERY_KEYS.task]: selection.taskId || undefined,
  [AGENT_STUDIO_QUERY_KEYS.session]: agentStudioSelectionSessionExternalId(selection) ?? undefined,
  [AGENT_STUDIO_QUERY_KEYS.agent]: selection.hasExplicitRoleSelection ? selection.role : undefined,
});
