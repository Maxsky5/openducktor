import type { AgentChatDraftPersistence } from "../send/agent-chat-draft-scope";
import { toAgentChatDraftStorageKey } from "../../drafts/agent-chat-draft-storage";
import type { AgentChatDraftStore } from "../../drafts/agent-chat-draft-store";

export const createWorkspaceSessionChatDraftPersistence = (
  drafts: AgentChatDraftStore,
  workspaceId: string,
  workspaceSessionId: string,
): AgentChatDraftPersistence => {
  const identity = { workspaceId, workspaceSessionId };
  return {
    targetKey: toAgentChatDraftStorageKey(identity),
    hydrate: () => drafts.hydrate(identity, null),
    set: (draft) => drafts.set(identity, null, draft),
    readVersion: () => drafts.readVersion(identity),
    clear: (options) => drafts.clear(identity, options),
    flush: () => drafts.flush(identity),
  };
};
