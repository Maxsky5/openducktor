import type { RuntimeRef } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "./messages";
import { historyToChatMessages } from "./persistence";

export type RuntimeTranscriptSessionInput = {
  repoPath: string;
  externalSessionId: string;
  runtimeRef: RuntimeRef;
  workingDirectory: string;
  history: AgentSessionHistoryMessage[];
  isLive?: boolean;
  pendingApprovals?: AgentSessionState["pendingApprovals"] | undefined;
  pendingQuestions?: AgentSessionState["pendingQuestions"] | undefined;
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
  repoPath,
  externalSessionId,
  runtimeRef,
  workingDirectory,
  history,
  isLive = false,
  pendingApprovals = [],
  pendingQuestions = [],
}: RuntimeTranscriptSessionInput): AgentSessionState => {
  const startedAt = history[0]?.timestamp ?? new Date(0).toISOString();

  return {
    externalSessionId,
    purpose: "transcript",
    taskId: "",
    repoPath,
    runtimeKind: runtimeRef.kind,
    role: null,
    status: isLive ? "running" : "idle",
    startedAt,
    runtimeId: runtimeRef.runtimeId,
    workingDirectory,
    historyHydrationState: "hydrated",
    runtimeRecoveryState: "idle",
    messages: createSessionMessagesState(
      externalSessionId,
      historyToChatMessages(history, {
        role: null,
        selectedModel: null,
      }),
      runtimeTranscriptHistoryVersion(history),
    ),
    draftAssistantText: "",
    draftAssistantMessageId: null,
    draftReasoningText: "",
    draftReasoningMessageId: null,
    contextUsage: null,
    pendingApprovals,
    pendingQuestions,
    todos: [],
    modelCatalog: null,
    selectedModel: null,
    isLoadingModelCatalog: false,
  };
};
