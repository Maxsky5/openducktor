import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { historyToChatMessages } from "@/state/operations/agent-orchestrator/support/session-history-chat-messages";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "../agent-chat.types";

type ReadonlyTranscriptSessionInput = AgentSessionIdentity & {
  history: AgentSessionHistoryMessage[];
};

const updateHash = (hash: number, value: string): number => {
  let nextHash = hash;
  for (let index = 0; index < value.length; index += 1) {
    nextHash = (nextHash * 31 + value.charCodeAt(index)) | 0;
  }
  return nextHash;
};

const transcriptHistoryVersion = (history: AgentSessionHistoryMessage[]): number => {
  let hash = history.length;
  for (const message of history) {
    hash = updateHash(hash, message.messageId);
    hash = updateHash(hash, message.role);
    hash = updateHash(hash, message.timestamp);
    hash = updateHash(hash, message.text);
    hash = updateHash(hash, JSON.stringify(message.parts));
  }
  return hash;
};

export const createReadonlyTranscriptSession = ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
  history,
}: ReadonlyTranscriptSessionInput): AgentChatThreadSession => ({
  ...toAgentSessionIdentity({ externalSessionId, runtimeKind, workingDirectory }),
  activityState: "idle",
  messages: createSessionMessagesState(
    externalSessionId,
    historyToChatMessages(history, {
      role: null,
    }),
    transcriptHistoryVersion(history),
  ),
  pendingApprovals: [],
  pendingQuestions: [],
  todos: [],
  selectedModel: null,
});
