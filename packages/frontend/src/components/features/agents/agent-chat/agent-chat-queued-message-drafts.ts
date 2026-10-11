import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { agentSessionRefKey } from "@openducktor/core";
import type { AgentChatComposerDraft } from "./agent-chat-composer-draft";

/**
 * Unsaved edits of queued messages, by session and host edit ID. They live as long as the app,
 * so an edit survives navigation to another chat. Save, Cancel, and Remove clear them. A new
 * edit has a new ID, so it never shows the draft of an edit that ended elsewhere.
 */
const drafts = new Map<string, AgentChatComposerDraft>();

const draftKey = (target: AgentSessionLiveRef, editId: string): string =>
  JSON.stringify([agentSessionRefKey(target), editId]);

export const readQueuedMessageEditDraft = (
  target: AgentSessionLiveRef,
  editId: string,
): AgentChatComposerDraft | null => drafts.get(draftKey(target, editId)) ?? null;

export const writeQueuedMessageEditDraft = (
  target: AgentSessionLiveRef,
  editId: string,
  draft: AgentChatComposerDraft,
): void => {
  drafts.set(draftKey(target, editId), draft);
};

export const clearQueuedMessageEditDraft = (target: AgentSessionLiveRef, editId: string): void => {
  drafts.delete(draftKey(target, editId));
};
