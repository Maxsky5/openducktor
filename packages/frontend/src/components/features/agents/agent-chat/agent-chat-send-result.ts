export type AgentChatSendRecovery = {
  kind: "recover_draft";
  originKey: string;
  recoveryKey: string;
  error: Error;
  /** The app already showed this error, so the composer does not show it again. */
  inAppFeedbackHandled?: boolean;
};

export type AgentChatSendResult = boolean | AgentChatSendRecovery;
