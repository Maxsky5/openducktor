import type { AgentModelSelection } from "@openducktor/core";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeTodoProjection, ClaudeTodoState } from "./claude-agent-sdk-todos";
import type { ClaudeManualCompactionState, ClaudeSessionActivity } from "./claude-agent-sdk-types";

export type ClaudeEventSession = {
  acceptedUserMessages?: readonly unknown[];
  activeBackgroundSubagentTaskIds?: Set<string>;
  activeManualCompaction?: ClaudeManualCompactionState;
  activeSdkUserTurnCount?: number;
  activity: ClaudeSessionActivity;
  assistantTurnOriginKind?: string;
  externalSessionId: string;
  hiddenSubagentTaskIds?: Set<string>;
  pendingApprovals?: Map<string, unknown>;
  pendingQuestions?: Map<string, unknown>;
  pendingUserTurnCount?: number;
  retractedSubagentTaskIds?: Set<string>;
  retractedToolUseIds?: Set<string>;
  lastAssistantTextMessageId?: string;
  lastAssistantText?: string;
  lastAssistantTextFinal?: boolean;
  lastAssistantTextModel?: AgentModelSelection;
  lastAssistantTextTurnIndex?: number;
  model?: AgentModelSelection | undefined;
  pendingSubagentAssistantMessage?: {
    messageId: string;
    model?: AgentModelSelection;
    text: string;
  };
  streamReasoningByBlockIndex?: Map<number, string>;
  streamAssistantResponseId?: string;
  streamAssistantMessageOrdinal: number;
  streamAssistantMessageIdsByBlockIndex: Map<number, string>;
  todoProjection?: ClaudeTodoProjection;
  todosById: ClaudeTodoState;
  toolEndedAtMsByCallId?: Map<string, number>;
  toolInputsByCallId: Map<string, Record<string, unknown>>;
  toolMessageIdsByCallId: Map<string, string>;
  toolNamesByCallId: Map<string, string>;
  toolStartedAtMsByCallId: Map<string, number>;
  subagentMessageIdsByTaskId: Map<string, string>;
  subagentAgentIdsByToolUseId?: Map<string, string>;
  subagentTaskIdsByToolUseId: Map<string, string>;
  subagentEventSessionsByToolUseId?: Map<string, ClaudeEventSession>;
};

export type ClaudeBackgroundWorkSession = {
  activeBackgroundSubagentTaskIds?: ReadonlySet<string>;
  subagentEventSessionsByToolUseId?: ReadonlyMap<string, ClaudeBackgroundWorkSession>;
};

export const hasActiveClaudeBackgroundWork = (session: ClaudeBackgroundWorkSession): boolean => {
  if ((session.activeBackgroundSubagentTaskIds?.size ?? 0) > 0) {
    return true;
  }
  for (const childSession of session.subagentEventSessionsByToolUseId?.values() ?? []) {
    if (hasActiveClaudeBackgroundWork(childSession)) {
      return true;
    }
  }
  return false;
};

export const claudeSubagentEventSession = (
  session: ClaudeEventSession,
  parentToolUseId: string,
): ClaudeEventSession | null => {
  const agentId =
    session.subagentAgentIdsByToolUseId?.get(parentToolUseId) ??
    session.subagentTaskIdsByToolUseId.get(parentToolUseId);
  if (!agentId) {
    return null;
  }
  session.subagentEventSessionsByToolUseId ??= new Map();
  const existing = session.subagentEventSessionsByToolUseId.get(parentToolUseId);
  if (existing) {
    existing.externalSessionId = claudeSubagentExternalSessionId(
      session.externalSessionId,
      agentId,
    );
    return existing;
  }
  const childSession: ClaudeEventSession = {
    activity: session.activity,
    externalSessionId: claudeSubagentExternalSessionId(session.externalSessionId, agentId),
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

const findClaudeToolOwnerSession = (
  session: ClaudeEventSession,
  toolUseId: string,
): ClaudeEventSession | null => {
  if (session.toolNamesByCallId.has(toolUseId)) {
    return session;
  }
  for (const childSession of session.subagentEventSessionsByToolUseId?.values() ?? []) {
    const owner = findClaudeToolOwnerSession(childSession, toolUseId);
    if (owner) {
      return owner;
    }
  }
  return null;
};

export const findClaudeSubagentOwnerByAgentId = (
  session: ClaudeEventSession,
  agentId: string,
): { session: ClaudeEventSession; toolUseId: string } | null => {
  for (const [toolUseId, ownedAgentId] of session.subagentAgentIdsByToolUseId ?? []) {
    if (ownedAgentId === agentId) {
      return { session, toolUseId };
    }
  }
  for (const [toolUseId, taskId] of session.subagentTaskIdsByToolUseId) {
    if (taskId === agentId) {
      return { session, toolUseId };
    }
  }
  for (const childSession of session.subagentEventSessionsByToolUseId?.values() ?? []) {
    const owner = findClaudeSubagentOwnerByAgentId(childSession, agentId);
    if (owner) {
      return owner;
    }
  }
  return null;
};

export const findClaudeSubagentSessionByAgentId = (
  session: ClaudeEventSession,
  agentId: string,
): ClaudeEventSession | null => {
  const owner = findClaudeSubagentOwnerByAgentId(session, agentId);
  return owner ? claudeSubagentEventSession(owner.session, owner.toolUseId) : null;
};

export const findClaudeSubagentTaskSession = (
  session: ClaudeEventSession,
  toolUseId: string | undefined,
  taskId: string,
): ClaudeEventSession | null => {
  if (toolUseId) {
    const toolOwner = findClaudeToolOwnerSession(session, toolUseId);
    if (toolOwner) {
      return toolOwner;
    }
  }
  for (const ownedTaskId of session.subagentTaskIdsByToolUseId.values()) {
    if (ownedTaskId === taskId) {
      return session;
    }
  }
  for (const childSession of session.subagentEventSessionsByToolUseId?.values() ?? []) {
    const owner = findClaudeSubagentTaskSession(childSession, toolUseId, taskId);
    if (owner) {
      return owner;
    }
  }
  return null;
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
  model?: AgentModelSelection,
  isFinal = false,
): void => {
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  session.lastAssistantTextMessageId = messageId;
  session.lastAssistantText = trimmed;
  session.lastAssistantTextFinal = isFinal;
  if (model) {
    session.lastAssistantTextModel = model;
  } else {
    delete session.lastAssistantTextModel;
  }
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
  const messageId =
    session.streamAssistantResponseId ??
    `claude-stream:${session.externalSessionId}:${activeAssistantTurnIndex(
      session,
    )}:${session.streamAssistantMessageOrdinal}:${blockIndex}`;
  session.streamAssistantMessageIdsByBlockIndex.set(blockIndex, messageId);
  return messageId;
};

export const advanceStreamAssistantMessageIdentity = (session: ClaudeEventSession): void => {
  if (session.streamAssistantMessageIdsByBlockIndex.size > 0) {
    session.streamAssistantMessageIdsByBlockIndex.clear();
    session.streamAssistantMessageOrdinal += 1;
  }
  delete session.streamAssistantResponseId;
  session.streamReasoningByBlockIndex?.clear();
};
