import type { AgentRole } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type AgentChatDraftScope = {
  taskId: string;
  role: AgentRole;
  session: AgentSessionIdentity | null;
};

const NEW_SESSION_DRAFT_SCOPE = "new";

const sessionScopeKey = (session: AgentSessionIdentity | null): string =>
  session ? agentSessionIdentityKey(session) : NEW_SESSION_DRAFT_SCOPE;

export const agentChatDraftScopeKey = ({ taskId, role, session }: AgentChatDraftScope): string =>
  [taskId, role, sessionScopeKey(session)].join(":");

export const didAgentChatDraftScopeSwitchSessionOnly = (
  previous: AgentChatDraftScope,
  next: AgentChatDraftScope,
): boolean =>
  previous.taskId === next.taskId &&
  previous.role === next.role &&
  sessionScopeKey(previous.session) !== sessionScopeKey(next.session);
