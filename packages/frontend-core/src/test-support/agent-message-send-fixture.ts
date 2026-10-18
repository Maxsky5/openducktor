import type {
  AgentMessageQueuePause,
  AgentMessageQueueSnapshot,
  AgentMessageTarget,
  AgentQueuedMessage,
  AgentTranscriptModelSelection,
} from "@openducktor/contracts";
import type {
  AcceptedAgentMessageSendReceipt,
  AgentSessionIdentity,
} from "../types/agent-orchestrator";

export const createAgentMessageSendReceipt = (
  recipient: AgentSessionIdentity = {
    runtimeKind: "opencode",
    externalSessionId: "builder",
    workingDirectory: "/tmp/worktree/task-10",
  },
): AcceptedAgentMessageSendReceipt => ({
  outcome: "accepted",
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

/** A host message queue with one queued text message for each text. */
export const createAgentMessageQueueSnapshot = ({
  target,
  revision = 1,
  texts = [],
  model,
  pause = null,
}: {
  target: AgentMessageTarget;
  revision?: number;
  /** Each text gets the submission ID "submission-<text>". */
  texts?: readonly string[];
  /** The model that each message captured. */
  model?: AgentTranscriptModelSelection;
  pause?: AgentMessageQueuePause | null;
}): AgentMessageQueueSnapshot => ({
  target,
  revision,
  entries: texts.map((text) => {
    const entry: AgentQueuedMessage = {
      submissionId: `submission-${text}`,
      parts: [{ kind: "text", text }],
      queuedAt: "2026-10-08T10:00:00.000Z",
      state: "queued",
    };
    if (model) entry.model = model;
    return entry;
  }),
  pause,
});
