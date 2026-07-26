import type { AgentModelSelection } from "@openducktor/core";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeTodoState } from "./claude-agent-sdk-todos";
import type { ClaudeManualCompactionState, ClaudeSessionActivity } from "./claude-agent-sdk-types";

export type ClaudeEventSession = {
  acceptedUserMessages?: readonly unknown[];
  activeManualCompaction?: ClaudeManualCompactionState;
  activeSdkUserTurnCount?: number;
  activity: ClaudeSessionActivity;
  externalSessionId: string;
  hiddenSubagentTaskIds?: Set<string>;
  pendingApprovals?: Map<string, unknown>;
  pendingQuestions?: Map<string, unknown>;
  pendingUserTurnCount?: number;
  retractedSubagentTaskIds?: Set<string>;
  retractedToolUseIds?: Set<string>;
  lastAssistantTextMessageId?: string;
  lastAssistantText?: string;
  lastAssistantTextTurnIndex?: number;
  model?: AgentModelSelection | undefined;
  streamAssistantMessageOrdinal: number;
  streamAssistantMessageIdsByBlockIndex: Map<number, string>;
  todosById: ClaudeTodoState;
  toolEndedAtMsByCallId?: Map<string, number>;
  toolInputsByCallId: Map<string, Record<string, unknown>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  toolStartedAtMsByCallId: Map<string, number>;
  subagentMessageIdsByTaskId: Map<string, string>;
  subagentTaskIdsByToolUseId: Map<string, string>;
  subagentEventSessionsByToolUseId?: Map<string, ClaudeEventSession>;
};

export const claudeSubagentEventSession = (
  session: ClaudeEventSession,
  parentToolUseId: string,
): ClaudeEventSession | null => {
  const taskId = session.subagentTaskIdsByToolUseId.get(parentToolUseId);
  if (!taskId) {
    return null;
  }
  session.subagentEventSessionsByToolUseId ??= new Map();
  const existing = session.subagentEventSessionsByToolUseId.get(parentToolUseId);
  if (existing) {
    return existing;
  }
  const childSession: ClaudeEventSession = {
    activity: session.activity,
    externalSessionId: claudeSubagentExternalSessionId(session.externalSessionId, taskId),
    streamAssistantMessageOrdinal: 0,
    streamAssistantMessageIdsByBlockIndex: new Map(),
    todosById: new Map(),
    toolInputsByCallId: new Map(),
    toolMessageIdsByCallId: new Map(),
    toolNamesByCallId: new Map(),
    toolStartedAtMsByCallId: new Map(),
    subagentMessageIdsByTaskId: new Map(),
    subagentTaskIdsByToolUseId: new Map(),
  };
  session.subagentEventSessionsByToolUseId.set(parentToolUseId, childSession);
  return childSession;
};

const acceptedUserTurnCount = (session: ClaudeEventSession): number => {
  return Array.isArray(session.acceptedUserMessages) ? session.acceptedUserMessages.length : 0;
};

const pendingUserTurnCount = (session: ClaudeEventSession): number => {
  return typeof session.pendingUserTurnCount === "number" ? session.pendingUserTurnCount : 0;
};

const activeAssistantTurnIndex = (session: ClaudeEventSession): number => {
  const acceptedTurns = acceptedUserTurnCount(session);
  const pendingTurns = pendingUserTurnCount(session);
  return pendingTurns > 0 ? acceptedTurns - pendingTurns + 1 : acceptedTurns;
};

export const rememberAssistantTextForCurrentTurn = (
  session: ClaudeEventSession,
  text: string,
  messageId: string,
): void => {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  session.lastAssistantTextMessageId = messageId;
  session.lastAssistantText = trimmed;
  session.lastAssistantTextTurnIndex = activeAssistantTurnIndex(session);
};

export const streamAssistantMessageId = (
  session: ClaudeEventSession,
  blockIndex: number,
): string => {
  const existing = session.streamAssistantMessageIdsByBlockIndex.get(blockIndex);
  if (existing) {
    return existing;
  }
  if (session.streamAssistantMessageOrdinal <= 0) {
    session.streamAssistantMessageOrdinal = 1;
  }
  const messageId = `claude-stream:${session.externalSessionId}:${activeAssistantTurnIndex(
    session,
  )}:${session.streamAssistantMessageOrdinal}:${blockIndex}`;
  session.streamAssistantMessageIdsByBlockIndex.set(blockIndex, messageId);
  return messageId;
};

export const advanceStreamAssistantMessageIdentity = (session: ClaudeEventSession): void => {
  if (session.streamAssistantMessageIdsByBlockIndex.size === 0) {
    return;
  }
  session.streamAssistantMessageIdsByBlockIndex.clear();
  session.streamAssistantMessageOrdinal += 1;
};
