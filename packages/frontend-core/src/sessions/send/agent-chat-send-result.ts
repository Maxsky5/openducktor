export type AgentChatSendRecovery = {
  kind: "recover_draft";
  originKey: string;
  recoveryKey: string;
  error: Error;
};

export type AgentChatSendResult = boolean | AgentChatSendRecovery;
