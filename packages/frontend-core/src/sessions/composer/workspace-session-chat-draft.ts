import type { AgentChatDraftPersistence } from "../send/agent-chat-draft-scope";
import { toAgentChatDraftStorageKey } from "../../drafts/agent-chat-draft-storage";
import type { AgentChatDraftStore } from "../../drafts/agent-chat-draft-store";

export const createWorkspaceSessionChatDraftPersistence = (
  drafts: AgentChatDraftStore,
  workspaceId: string,
  workspaceSessionId: string,
): AgentChatDraftPersistence => {
  const identity = { workspaceId, workspaceSessionId };
  let isLocalSet = false;
  return {
    targetKey: toAgentChatDraftStorageKey(identity),
    hydrate: () => drafts.hydrate(identity, null),
    set: (draft) => {
      isLocalSet = true;
      try {
        return drafts.set(identity, null, draft);
      } finally {
        isLocalSet = false;
      }
    },
    readVersion: () => drafts.readVersion(identity),
    clear: (options) => drafts.clear(identity, options),
    flush: () => drafts.flush(identity),
    subscribeCleared: (onClear) => drafts.subscribeCleared(identity, onClear),
    subscribeExternalChange: (onChange) =>
      drafts.subscribeChanged(identity, () => {
        if (!isLocalSet) onChange();
      }),
  };
};
