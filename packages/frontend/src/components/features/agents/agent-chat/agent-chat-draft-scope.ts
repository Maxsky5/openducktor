import type { AgentChatComposerDraft } from "./agent-chat-composer-draft";

export type AgentChatDraftPersistence = {
  /** Equivalent adapter wrappers must share this key; different persistence targets must not. */
  targetKey: string;
  hydrate: () => AgentChatComposerDraft;
  set: (draft: AgentChatComposerDraft) => number;
  readVersion: () => number | null;
  clear: (options?: { onlyIfVersion?: number | null }) => boolean;
  flush: () => Promise<void>;
};

export type AgentChatDraftScope = {
  key: string;
  persistence: AgentChatDraftPersistence | null;
};
