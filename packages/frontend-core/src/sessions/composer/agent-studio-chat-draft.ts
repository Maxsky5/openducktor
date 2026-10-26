import type { AgentRole } from "@openducktor/core";
import type { AgentChatDraftPersistence } from "../send/agent-chat-draft-scope";
import {
  type AgentChatDraftSessionIdentity,
  toAgentChatDraftStorageKey,
} from "../../drafts/agent-chat-draft-storage";
import type { AgentChatDraftStore } from "../../drafts/agent-chat-draft-store";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import type { AgentSessionIdentity } from "../../types/agent-orchestrator";

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
  drafts,
  workspaceId,
  taskId,
  session,
}: {
  drafts: AgentChatDraftStore;
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
    hydrate: () => drafts.hydrate(identity, taskId),
    set: (draft) => drafts.set(identity, taskId, draft),
    readVersion: () => drafts.readVersion(identity),
    clear: (options) => drafts.clear(identity, options),
    flush: () => drafts.flush(identity),
  };
};
