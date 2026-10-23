import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { childSessions } from "./claude-agent-sdk-session-children";
import type { AgentModelSelection } from "@openducktor/core";
import type { ErrorState } from "./claude-agent-sdk-errors";
import type { ClaudeBackgroundToolState } from "./claude-agent-sdk-background-tools";
import type { ClaudeNativeActivityState } from "./claude-agent-sdk-activity";
import { claudeSubagentExternalSessionId } from "./claude-agent-sdk-subagent-transcripts";
import type { ClaudeTodoProjection, ClaudeTodoState } from "./claude-agent-sdk-todos";
import type {
  ClaudeAcceptedUserMessage,
  ClaudeManualCompactionState,
  PendingApproval,
  PendingQuestion,
  ClaudeSessionActivity,
} from "./claude-agent-sdk-types";

export type ClaudeEventSession = ClaudeBackgroundToolState &
  ClaudeNativeActivityState &
  ErrorState & {
    appliedPermissionMode?: string;
    disabledTools?: ReadonlySet<string>;
    requestedPermissionMode?: string;
    acceptedUserMessages?: readonly ClaudeAcceptedUserMessage[];
    activeBackgroundSubagentTaskIds?: Set<string>;
    activeManualCompaction?: ClaudeManualCompactionState;
    activeSdkUserTurnCount?: number;
    activity: ClaudeSessionActivity;
    assistantTurnOriginKind?: string;
    externalSessionId: string;
    hiddenSubagentTaskIds?: Set<string>;
    pendingApprovals?: Map<string, PendingApproval>;
    pendingQuestions?: Map<string, PendingQuestion>;
    pendingUserTurnCount?: number;
    sdkInitiatedTurnActive?: boolean;
    resultAwaitsSdkIdle?: boolean;
    retractedSubagentTaskIds?: Set<string>;
    retractedToolUseIds?: Set<string>;
    lastAssistantTextMessageId?: string;
    lastAssistantText?: string;
    lastAssistantTextFinal?: boolean;
    lastAssistantTextModel?: AgentModelSelection;
    lastAssistantTextTurnIndex?: number;
    lastSuccessfulResultTurnIndex?: number;
    lastAssistantNativeUuid?: string;
    lastAssistantNativeUuidTurnIndex?: number;
    completedReplyChainIds?: Map<string, string>;
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
    toolStartedAtMsByCallId: Map<string, number>;
    subagentMessageIdsByTaskId: Map<string, string>;
    subagentAgentIdsByToolUseId?: Map<string, string>;
    subagentTaskIdsByToolUseId: Map<string, string>;
    subagentEventSessionsByToolUseId?: Map<string, ClaudeEventSession>;
    subagentEventSessionsByTaskId?: Map<string, ClaudeEventSession>;
    unreadSteeredUserMessages?: Map<string, ClaudeAcceptedUserMessage>;
  };

export type ClaudeBackgroundWorkSession = ClaudeNativeActivityState & {
  backgroundToolActiveTaskIds?: ReadonlySet<string>;
  activeBackgroundSubagentTaskIds?: ReadonlySet<string>;
  subagentEventSessionsByToolUseId?: ReadonlyMap<string, ClaudeBackgroundWorkSession>;
  subagentEventSessionsByTaskId?: ReadonlyMap<string, ClaudeBackgroundWorkSession>;
};

export const userTurnIndex = (
  session: Pick<ClaudeEventSession, "acceptedUserMessages" | "pendingUserTurnCount">,
): number => {
  const accepted = Array.isArray(session.acceptedUserMessages)
    ? session.acceptedUserMessages.length
    : 0;
  const pending = session.pendingUserTurnCount ?? 0;
  return pending > 0 ? accepted - pending + 1 : accepted;
};

export const hasActiveClaudeBackgroundTools = (session: ClaudeBackgroundWorkSession): boolean => {
  if ((session.backgroundToolActiveTaskIds?.size ?? 0) > 0) {
    return true;
  }
  for (const child of childSessions(session)) {
    if (hasActiveClaudeBackgroundTools(child)) {
      return true;
    }
  }
  return false;
};

export const hasActiveClaudeBackgroundWork = (session: ClaudeBackgroundWorkSession): boolean => {
  if (
    (session.activeBackgroundSubagentTaskIds?.size ?? 0) > 0 ||
    (session.backgroundToolActiveTaskIds?.size ?? 0) > 0
  ) {
    return true;
  }
  for (const childSession of childSessions(session)) {
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
  const childSession = createClaudeSubagentEventSession(session, agentId);
  session.subagentEventSessionsByToolUseId.set(parentToolUseId, childSession);
  return childSession;
};

export type ClaudeSubagentOwner = {
  session: ClaudeEventSession;
  toolUseId: string;
};

export const findClaudeSubagentOwnerByAgentId = (
  session: ClaudeEventSession,
  agentId: string,
): ClaudeSubagentOwner | null => {
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
  for (const childSession of childSessions(session)) {
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
  const direct = session.subagentEventSessionsByTaskId?.get(agentId);
  if (direct) return direct;
  const owner = findClaudeSubagentOwnerByAgentId(session, agentId);
  if (owner) return claudeSubagentEventSession(owner.session, owner.toolUseId);
  for (const child of childSessions(session)) {
    const found = findClaudeSubagentSessionByAgentId(child, agentId);
    if (found) return found;
  }
  return null;
};

export const findClaudeSubagentTaskSession = (
  session: ClaudeEventSession,
  toolUseId: string | undefined,
  taskId: string,
): ClaudeEventSession | null => {
  if (session.subagentEventSessionsByTaskId?.has(taskId)) return session;
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
  for (const childSession of childSessions(session)) {
    const owner = findClaudeSubagentTaskSession(childSession, toolUseId, taskId);
    if (owner) {
      return owner;
    }
  }
  return session.backgroundToolTasksById?.get(taskId)?.toolUseId ? session : null;
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
  session.lastAssistantTextTurnIndex = userTurnIndex(session);
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
    `claude-stream:${session.externalSessionId}:${userTurnIndex(
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

/** A full task list can restore a child route when its launch event was missed. */
export const updateTaskRoutes = (
  session: ClaudeEventSession,
  tasks: Extract<SDKMessage, { subtype: "background_tasks_changed" }>["tasks"],
): void => {
  let remaining = tasks.filter(
    (task) =>
      task.run_id &&
      !task.ambient &&
      (task.task_type === "local_agent" || task.task_type === "remote_agent"),
  );
  while (remaining.length > 0) {
    const pending: typeof remaining = [];
    for (const task of remaining) {
      const parent = task.parent_task_id
        ? findClaudeSubagentSessionByAgentId(session, task.parent_task_id)
        : session;
      if (!parent || (task.parent_task_id && !session.nativeTaskRuns?.has(task.parent_task_id))) {
        pending.push(task);
        continue;
      }
      parent.subagentEventSessionsByTaskId ??= new Map();
      if (!parent.subagentEventSessionsByTaskId.has(task.task_id)) {
        const known = findClaudeSubagentSessionByAgentId(session, task.task_id);
        parent.subagentEventSessionsByTaskId.set(
          task.task_id,
          known ?? createClaudeSubagentEventSession(parent, task.task_id),
        );
      }
    }
    if (pending.length === remaining.length) break;
    remaining = pending;
  }
};

export const retireClaudeChildSession = (
  session: Pick<ClaudeEventSession, "subagentEventSessionsByToolUseId">,
  toolUseId: string,
): void => {
  const child = session.subagentEventSessionsByToolUseId?.get(toolUseId);
  if (
    child &&
    (hasActiveClaudeBackgroundWork(child) ||
      child.subagentEventSessionsByTaskId?.size ||
      child.pendingApprovals?.size ||
      child.pendingQuestions?.size)
  )
    return;
  session.subagentEventSessionsByToolUseId?.delete(toolUseId);
};

const createClaudeSubagentEventSession = (
  session: ClaudeEventSession,
  agentId: string,
): ClaudeEventSession => {
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
  if (session.backgroundToolCallIdsSinceSnapshot) {
    childSession.backgroundToolCallIdsSinceSnapshot = new Set();
  }
  if (session.disabledTools) childSession.disabledTools = session.disabledTools;
  return childSession;
};

const findClaudeToolOwnerSession = (
  session: ClaudeEventSession,
  toolUseId: string,
): ClaudeEventSession | null => {
  if (session.toolNamesByCallId.has(toolUseId)) {
    return session;
  }
  for (const childSession of childSessions(session)) {
    const owner = findClaudeToolOwnerSession(childSession, toolUseId);
    if (owner) {
      return owner;
    }
  }
  return null;
};
