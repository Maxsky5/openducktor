import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import type { AgentChatComposerDraft } from "./agent-chat-composer-draft";

/**
 * Unsaved edits of queued messages, by session and host edit ID. They live as long as their host
 * connection. Thus an edit survives navigation to another chat. Save, Cancel, and Remove clear
 * them. The host gives each edit a new ID. Thus a new edit never shows the draft of an edit that
 * ended elsewhere.
 */
export type QueuedMessageEditDrafts = {
  read(target: AgentSessionLiveRef, editId: string): AgentChatComposerDraft | null;
  write(target: AgentSessionLiveRef, editId: string, draft: AgentChatComposerDraft): void;
  clear(target: AgentSessionLiveRef, editId: string): void;
  dispose(): void;
};

const draftKey = (target: AgentSessionLiveRef, editId: string): string =>
  JSON.stringify([agentSessionRefKey(target), editId]);

export const createQueuedMessageEditDrafts = (): QueuedMessageEditDrafts => {
  const drafts = new Map<string, AgentChatComposerDraft>();
  return {
    read: (target, editId) => drafts.get(draftKey(target, editId)) ?? null,
    write: (target, editId, draft) => {
      drafts.set(draftKey(target, editId), draft);
    },
    clear: (target, editId) => {
      drafts.delete(draftKey(target, editId));
    },
    dispose: () => drafts.clear(),
  };
};
