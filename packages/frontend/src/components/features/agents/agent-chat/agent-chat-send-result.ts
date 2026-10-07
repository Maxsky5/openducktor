import type { AgentChatDraftPersistence } from "./agent-chat-draft-scope";

export type AgentChatSendRecovery = {
  kind: "recover_draft";
  originKey: string;
  recoveryKey: string;
  error: Error;
  persistence?: AgentChatDraftPersistence | null;
  onRecovered?: (clear: () => void) => void;
  inAppFeedbackHandled?: boolean;
};

export type AgentChatSendResult = boolean | AgentChatSendRecovery;
