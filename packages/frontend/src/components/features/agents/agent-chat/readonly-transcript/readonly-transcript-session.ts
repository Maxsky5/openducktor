import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { historyToChatMessages } from "@/state/operations/agent-orchestrator/support/persistence";
import type { AgentChatThreadSession } from "../agent-chat.types";

type ReadonlyTranscriptSessionInput = {
  externalSessionId: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  history: AgentSessionHistoryMessage[];
  pendingApprovals?: AgentChatThreadSession["pendingApprovals"] | undefined;
  pendingQuestions?: AgentChatThreadSession["pendingQuestions"] | undefined;
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
  pendingApprovals = [],
  pendingQuestions = [],
}: ReadonlyTranscriptSessionInput): AgentChatThreadSession => ({
  externalSessionId,
  runtimeKind,
  status: pendingApprovals.length > 0 || pendingQuestions.length > 0 ? "running" : "idle",
  workingDirectory,
  messages: createSessionMessagesState(
    externalSessionId,
    historyToChatMessages(history, {
      role: null,
      selectedModel: null,
    }),
    transcriptHistoryVersion(history),
  ),
  pendingApprovals,
  pendingQuestions,
  todos: [],
  selectedModel: null,
});
