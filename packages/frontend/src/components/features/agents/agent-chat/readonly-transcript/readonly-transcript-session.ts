import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { createSessionMessagesState } from "@/state/operations/agent-orchestrator/support/messages";
import { historyToChatMessages } from "@/state/operations/agent-orchestrator/support/session-history-chat-messages";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "../agent-chat.types";
import type { AgentSessionTranscriptTarget } from "../agent-session-transcript-target";

type ReadonlyTranscriptSessionInput = AgentSessionTranscriptTarget & {
  history: AgentSessionHistoryMessage[];
};

const EMPTY_READONLY_RUNTIME_SESSION_STARTED_AT = "1970-01-01T00:00:00.000Z";

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
    hash = updateHash(hash, JSON.stringify(message.role === "system" ? message.notice : null));
  }
  return hash;
};

export const createReadonlyTranscriptSession = ({
  externalSessionId,
  runtimeKind,
  sessionScope,
  workingDirectory,
  history,
}: ReadonlyTranscriptSessionInput): AgentChatThreadSession => ({
  ...toAgentSessionIdentity({ externalSessionId, runtimeKind, workingDirectory }),
  ...(sessionScope ? { sessionScope } : {}),
  activityState: null,
  runtimeStatusMessage: null,
  messages: createSessionMessagesState(
    externalSessionId,
    historyToChatMessages(history, {
      role: null,
    }),
    transcriptHistoryVersion(history),
  ),
});

export const createReadonlyRuntimeSessionState = ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
  history,
}: ReadonlyTranscriptSessionInput): AgentSessionState => ({
  ...toAgentSessionIdentity({ externalSessionId, runtimeKind, workingDirectory }),
  taskId: "",
  role: null,
  status: "idle",
  runtimeStatusMessage: null,
  startedAt: history[0]?.timestamp ?? EMPTY_READONLY_RUNTIME_SESSION_STARTED_AT,
  historyLoadState: "loaded",
  messages: createSessionMessagesState(
    externalSessionId,
    historyToChatMessages(history, {
      role: null,
    }),
    transcriptHistoryVersion(history),
  ),
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
});

export const createEmptyReadonlyRuntimeSessionState = ({
  externalSessionId,
  runtimeKind,
  workingDirectory,
}: AgentSessionTranscriptTarget): AgentSessionState => ({
  ...toAgentSessionIdentity({ externalSessionId, runtimeKind, workingDirectory }),
  taskId: "",
  role: null,
  status: "idle",
  runtimeStatusMessage: null,
  startedAt: EMPTY_READONLY_RUNTIME_SESSION_STARTED_AT,
  historyLoadState: "loading",
  messages: createSessionMessagesState(externalSessionId),
  contextUsage: null,
  pendingApprovals: [],
  pendingQuestions: [],
  selectedModel: null,
});

const areMessagesEquivalent = (left: AgentChatMessage, right: AgentChatMessage): boolean =>
  left.id === right.id &&
  left.role === right.role &&
  left.content === right.content &&
  left.timestamp === right.timestamp &&
  left.meta === right.meta;

const areMessageListsEquivalent = (
  left: readonly AgentChatMessage[],
  right: readonly AgentChatMessage[],
): boolean => {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((message, index) => {
    const nextMessage = right[index];
    return nextMessage !== undefined && areMessagesEquivalent(message, nextMessage);
  });
};

export const mergeReadonlyRuntimeHistory = (
  session: AgentSessionState,
  history: AgentSessionHistoryMessage[],
): AgentSessionState => {
  const historyMessages = historyToChatMessages(history, { role: null });
  const historyMessageIds = new Set(historyMessages.map((message) => message.id));
  const liveMessageById = new Map(session.messages.items.map((message) => [message.id, message]));
  const mergedMessages = [
    ...historyMessages.map((message) => liveMessageById.get(message.id) ?? message),
    ...session.messages.items.filter((message) => !historyMessageIds.has(message.id)),
  ];

  if (
    session.historyLoadState === "loaded" &&
    areMessageListsEquivalent(session.messages.items, mergedMessages)
  ) {
    return session;
  }

  return {
    ...session,
    startedAt: history[0]?.timestamp ?? session.startedAt,
    historyLoadState: "loaded",
    messages: createSessionMessagesState(
      session.externalSessionId,
      mergedMessages,
      session.messages.version + 1,
    ),
  };
};
