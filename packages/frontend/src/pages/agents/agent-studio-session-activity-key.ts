import type { AgentRole } from "@openducktor/core";
import {
  type AgentSessionIdentityLike,
  agentSessionIdentityKey,
} from "@openducktor/frontend-core/lib/agent-session-identity";

export type AgentStudioSessionActivityKeyParams = {
  workspaceId: string | null;
  taskId: string;
  role: AgentRole;
  session: AgentSessionIdentityLike | null | undefined;
};

export const buildAgentStudioSessionActivityKey = (
  params: AgentStudioSessionActivityKeyParams,
): string => {
  const workspaceId = params.workspaceId ?? "__no_workspace__";
  const sessionKey = params.session ? agentSessionIdentityKey(params.session) : "__draft__";
  return `${workspaceId}:${params.taskId}:${params.role}:${sessionKey}`;
};
