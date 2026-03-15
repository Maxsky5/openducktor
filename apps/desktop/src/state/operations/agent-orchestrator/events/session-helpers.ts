import type { AgentSessionState } from "@/types/agent-orchestrator";
import { isTodoToolName, settleDanglingTodoToolMessages } from "../../agent-tool-messages";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { finalizeDraftAssistantMessage, sanitizeStreamingText } from "../support/utils";
import type {
  DraftChannel,
  DraftChannelValueMap,
  SessionEventContext,
  SessionPart,
} from "./session-event-types";

const DRAFT_FLUSH_DELAY_MS = 32;

export const inferToolPartStatus = (
  part: Extract<SessionPart, { kind: "tool" }>,
): Extract<SessionPart, { kind: "tool" }>["status"] => {
  return part.status;
};

export const clearDraftBuffers = (context: SessionEventContext): void => {
  const timeoutId = context.draftFlushTimeoutBySessionRef?.current[context.sessionId];
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
  if (context.draftFlushTimeoutBySessionRef) {
    delete context.draftFlushTimeoutBySessionRef.current[context.sessionId];
  }
  delete context.draftRawBySessionRef.current[context.sessionId];
  delete context.draftSourceBySessionRef.current[context.sessionId];
  if (context.draftMessageIdBySessionRef) {
    delete context.draftMessageIdBySessionRef.current[context.sessionId];
  }
};

export const eventTimestampMs = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const resolveDraftFieldState = (
  channel: DraftChannel,
  rawByChannel: DraftChannelValueMap<string> | undefined,
  messageIdByChannel: DraftChannelValueMap<string> | undefined,
): { text: string; messageId: string | null } => {
  const raw = rawByChannel?.[channel] ?? "";
  const text = sanitizeStreamingText(raw);
  const messageId = text.length > 0 ? (messageIdByChannel?.[channel] ?? null) : null;
  return { text, messageId };
};

export const flushDraftBuffers = (context: SessionEventContext): void => {
  const timeoutId = context.draftFlushTimeoutBySessionRef?.current[context.sessionId];
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    if (context.draftFlushTimeoutBySessionRef) {
      delete context.draftFlushTimeoutBySessionRef.current[context.sessionId];
    }
  }

  const rawByChannel = context.draftRawBySessionRef.current[context.sessionId];
  const messageIdByChannel = context.draftMessageIdBySessionRef?.current[context.sessionId];
  const reasoningDraft = resolveDraftFieldState("reasoning", rawByChannel, messageIdByChannel);

  context.updateSession(
    context.sessionId,
    (current) => ({
      ...current,
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: reasoningDraft.text,
      draftReasoningMessageId: reasoningDraft.messageId,
    }),
    { persist: false },
  );
};

export const scheduleDraftFlush = (context: SessionEventContext): void => {
  const draftFlushTimeoutBySessionRef = context.draftFlushTimeoutBySessionRef;
  if (!draftFlushTimeoutBySessionRef) {
    flushDraftBuffers(context);
    return;
  }

  const existingTimeoutId = draftFlushTimeoutBySessionRef.current[context.sessionId];
  if (existingTimeoutId !== undefined) {
    clearTimeout(existingTimeoutId);
  }

  draftFlushTimeoutBySessionRef.current[context.sessionId] = setTimeout(() => {
    delete draftFlushTimeoutBySessionRef.current[context.sessionId];
    flushDraftBuffers(context);
  }, DRAFT_FLUSH_DELAY_MS);
};

const hasMeaningfulToolInputValue = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasMeaningfulToolInputValue(entry));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.values(value as Record<string, unknown>).some((entry) =>
    hasMeaningfulToolInputValue(entry),
  );
};

export const hasMeaningfulToolInput = (input: Record<string, unknown> | undefined): boolean => {
  if (!input) {
    return false;
  }
  return Object.values(input).some((value) => hasMeaningfulToolInputValue(value));
};

const shouldClearTurnFromCurrentState = (current: AgentSessionState): boolean => {
  return (
    (current.draftAssistantText.trim().length > 0 ||
      current.draftReasoningText.trim().length > 0) &&
    current.pendingPermissions.length === 0 &&
    current.pendingQuestions.length === 0
  );
};

export const settleDraftToIdle = (context: SessionEventContext, timestamp: string): boolean => {
  let shouldClear = false;
  context.updateSession(context.sessionId, (current) => {
    const finalized = finalizeDraftAssistantMessage(
      current,
      timestamp,
      context.resolveTurnDurationMs(context.sessionId, timestamp, current.messages),
    );
    shouldClear = shouldClearTurnFromCurrentState(current);
    return {
      ...finalized,
      messages: settleDanglingTodoToolMessages(finalized.messages, timestamp),
      ...(current.status === "error" ? { status: "error" } : { status: "idle" }),
    };
  });
  return shouldClear;
};

export const toPartStreamKey = (part: SessionPart): string => {
  if (part.kind === "tool") {
    return `${part.messageId}:${part.callId || part.partId}`;
  }
  return `${part.messageId}:${part.partId}`;
};

export const createPrePartTodoSettlement = (
  part: SessionPart,
  timestamp: string,
): ((current: AgentSessionState) => AgentSessionState) => {
  const shouldSettleTodoToolRows = part.kind !== "tool" || !isTodoToolName(part.tool);
  return (current: AgentSessionState): AgentSessionState => {
    if (!shouldSettleTodoToolRows) {
      return current;
    }
    const settledMessages = settleDanglingTodoToolMessages(current.messages, timestamp);
    if (settledMessages === current.messages) {
      return current;
    }
    return {
      ...current,
      messages: settledMessages,
    };
  };
};

export const refreshTodosFromSessionRef = (context: SessionEventContext): void => {
  const session = context.sessionsRef.current[context.sessionId];
  if (!session) {
    return;
  }
  const runtimeKind = session.runtimeKind ?? session.selectedModel?.runtimeKind;
  if (!runtimeKind) {
    throw new Error(
      `Runtime kind is required to refresh todos for session '${context.sessionId}'.`,
    );
  }
  runOrchestratorSideEffect(
    "session-events-refresh-todos",
    context.loadSessionTodos(
      context.sessionId,
      runtimeKind,
      {
        endpoint: session.runtimeEndpoint,
        workingDirectory: session.workingDirectory,
      },
      session.externalSessionId,
    ),
    {
      tags: {
        repoPath: context.repoPath,
        sessionId: context.sessionId,
        taskId: session.taskId,
        role: session.role,
        externalSessionId: session.externalSessionId,
      },
    },
  );
};
