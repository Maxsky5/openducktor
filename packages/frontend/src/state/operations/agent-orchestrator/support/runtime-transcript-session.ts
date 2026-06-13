import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "./messages";
import { historyToChatMessages } from "./persistence";

export type RuntimeTranscriptSession = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "status"
  | "runtimeKind"
  | "workingDirectory"
  | "messages"
  | "pendingApprovals"
  | "pendingQuestions"
  | "todos"
  | "selectedModel"
>;

export type RuntimeTranscriptSessionInput = {
  externalSessionId: string;
  runtimeKind: RuntimeKind;
  workingDirectory: string;
  history: AgentSessionHistoryMessage[];
  pendingApprovals?: RuntimeTranscriptSession["pendingApprovals"] | undefined;
  pendingQuestions?: RuntimeTranscriptSession["pendingQuestions"] | undefined;
};

const updateHash = (hash: number, value: string): number => {
  let nextHash = hash;
  for (let index = 0; index < value.length; index += 1) {
    nextHash = (nextHash * 31 + value.charCodeAt(index)) | 0;
  }
  return nextHash;
};

const runtimeTranscriptHistoryVersion = (history: AgentSessionHistoryMessage[]): number => {
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

export const createRuntimeTranscriptSession = ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
  history,
  pendingApprovals = [],
  pendingQuestions = [],
}: RuntimeTranscriptSessionInput): RuntimeTranscriptSession => {
  const status = pendingApprovals.length > 0 || pendingQuestions.length > 0 ? "running" : "idle";

  return {
    externalSessionId,
    runtimeKind,
    status,
    workingDirectory,
    messages: createSessionMessagesState(
      externalSessionId,
      historyToChatMessages(history, {
        role: null,
        selectedModel: null,
      }),
      runtimeTranscriptHistoryVersion(history),
    ),
    pendingApprovals,
    pendingQuestions,
    todos: [],
    selectedModel: null,
  };
};
