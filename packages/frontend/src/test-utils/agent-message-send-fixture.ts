import type { AgentMessageSendReceipt, AgentSessionIdentity } from "@/types/agent-orchestrator";

export const createAgentMessageSendReceipt = (
  recipient: AgentSessionIdentity = {
    runtimeKind: "opencode",
    externalSessionId: "builder",
    workingDirectory: "/tmp/worktree/task-10",
  },
): AgentMessageSendReceipt => ({
  recipient,
  acceptedMessage: {
    type: "user_message",
    externalSessionId: recipient.externalSessionId,
    timestamp: "2026-10-08T00:00:00.000Z",
    messageId: "accepted-message",
    message: "Resolve the Git conflict",
    parts: [{ kind: "text", text: "Resolve the Git conflict" }],
    state: "read",
  },
  postAcceptanceFailure: null,
});
