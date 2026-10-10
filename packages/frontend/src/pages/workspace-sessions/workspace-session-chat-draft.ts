import type { AgentChatDraftPersistence } from "@/components/features/agents/agent-chat/agent-chat-draft-scope";
import { toAgentChatDraftStorageKey } from "@/components/features/agents/agent-chat/agent-chat-draft-storage";
import {
  clearAgentChatDraft,
  flushAgentChatDraft,
  hydrateAgentChatDraft,
  readAgentChatDraftVersion,
  setAgentChatDraft,
} from "@/components/features/agents/agent-chat/agent-chat-draft-store";

export const createWorkspaceSessionChatDraftPersistence = (
  workspaceId: string,
  workspaceSessionId: string,
): AgentChatDraftPersistence => {
  const identity = { workspaceId, workspaceSessionId };
  return {
    targetKey: toAgentChatDraftStorageKey(identity),
    hydrate: () => hydrateAgentChatDraft(identity, null),
    set: (draft) => setAgentChatDraft(identity, null, draft),
    readVersion: () => readAgentChatDraftVersion(identity),
    clear: (options) => clearAgentChatDraft(identity, options),
    flush: () => flushAgentChatDraft(identity),
  };
};
