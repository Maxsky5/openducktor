import type { AgentModelSelection } from "@openducktor/core";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeTodoState } from "./claude-agent-sdk-todos";
import type { ClaudeSessionActivity } from "./claude-agent-sdk-types";
import { isRecord, readStringProp } from "./claude-agent-sdk-utils";

export type ClaudeEventSession = {
  acceptedUserMessages?: readonly unknown[];
  activeSdkUserTurnCount?: number;
  activity: ClaudeSessionActivity;
  externalSessionId: string;
  hiddenSubagentTaskIds?: Set<string>;
  pendingApprovals?: Map<string, unknown>;
  pendingQuestions?: Map<string, unknown>;
  pendingUserTurnCount?: number;
  retractedSubagentTaskIds?: Set<string>;
  retractedToolUseIds?: Set<string>;
  lastAssistantText?: string;
  lastAssistantTextTurnIndex?: number;
  model?: AgentModelSelection | undefined;
  streamAssistantMessageOrdinal: number;
  streamAssistantMessageIdsByBlockIndex: Map<number, string>;
  todosById: ClaudeTodoState;
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
): void => {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
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

export const streamedTextMessageIdForBlock = (
  session: ClaudeEventSession,
  fallbackMessageId: string,
  blockIndex: number,
): string => session.streamAssistantMessageIdsByBlockIndex.get(blockIndex) ?? fallbackMessageId;

export const streamedTextMessageIdsForContent = (
  session: ClaudeEventSession,
  content: unknown,
): string[] => {
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .map((block, index) =>
      isRecord(block) && readStringProp(block, "type") === "text" ? index : null,
    )
    .filter((index): index is number => index !== null)
    .flatMap((index) => {
      const messageId = session.streamAssistantMessageIdsByBlockIndex.get(index);
      return messageId ? [messageId] : [];
    });
};

export const finalAssistantTextMessageId = (
  session: ClaudeEventSession,
  fallbackMessageId: string,
  content: unknown,
): string => {
  return streamedTextMessageIdsForContent(session, content)[0] ?? fallbackMessageId;
};

export const advanceStreamAssistantMessageIdentity = (session: ClaudeEventSession): void => {
  if (session.streamAssistantMessageIdsByBlockIndex.size === 0) {
    return;
  }
  session.streamAssistantMessageIdsByBlockIndex.clear();
  session.streamAssistantMessageOrdinal += 1;
};
