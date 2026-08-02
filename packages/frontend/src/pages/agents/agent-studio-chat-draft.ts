import type { AgentRole } from "@openducktor/core";
import type { AgentChatDraftPersistence } from "@/components/features/agents/agent-chat/agent-chat-draft-scope";
import {
  type AgentChatDraftSessionIdentity,
  toAgentChatDraftStorageKey,
} from "@/components/features/agents/agent-chat/agent-chat-draft-storage";
import {
  clearAgentChatDraft,
  flushAgentChatDraft,
  hydrateAgentChatDraft,
  readAgentChatDraftVersion,
  setAgentChatDraft,
} from "@/components/features/agents/agent-chat/agent-chat-draft-store";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

export type AgentStudioChatDraftScope = {
  taskId: string;
  role: AgentRole;
  session: AgentSessionIdentity | null;
};

const NEW_SESSION_DRAFT_SCOPE = "new";

const sessionScopeKey = (session: AgentSessionIdentity | null): string =>
  session ? agentSessionIdentityKey(session) : NEW_SESSION_DRAFT_SCOPE;

export const agentStudioChatDraftScopeKey = (
  workspaceId: string | null,
  { taskId, role, session }: AgentStudioChatDraftScope,
): string => [workspaceId ?? "", taskId, role, sessionScopeKey(session)].join(":");

export const didAgentStudioChatDraftScopeSwitchSessionOnly = (
  previous: AgentStudioChatDraftScope,
  next: AgentStudioChatDraftScope,
): boolean =>
  previous.taskId === next.taskId &&
  previous.role === next.role &&
  sessionScopeKey(previous.session) !== sessionScopeKey(next.session);

const toPersistenceIdentity = (
  workspaceId: string | null,
  session: AgentSessionIdentity | null,
): AgentChatDraftSessionIdentity | null => {
  if (!workspaceId || !session) {
    return null;
  }

  return {
    workspaceId,
    externalSessionId: session.externalSessionId,
    runtimeKind: session.runtimeKind,
    workingDirectory: session.workingDirectory,
  };
};

export const createAgentStudioChatDraftPersistence = ({
  workspaceId,
  taskId,
  session,
}: {
  workspaceId: string | null;
  taskId: string;
  session: AgentSessionIdentity | null;
}): AgentChatDraftPersistence | null => {
  const identity = toPersistenceIdentity(workspaceId, session);
  if (!identity) {
    return null;
  }

  return {
    targetKey: toAgentChatDraftStorageKey(identity),
    hydrate: () => hydrateAgentChatDraft(identity, taskId),
    set: (draft) => setAgentChatDraft(identity, taskId, draft),
    readVersion: () => readAgentChatDraftVersion(identity),
    clear: (options) => clearAgentChatDraft(identity, options),
    flush: () => flushAgentChatDraft(identity),
  };
};
