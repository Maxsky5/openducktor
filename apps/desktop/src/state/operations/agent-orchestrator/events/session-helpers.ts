import type { AgentSessionState } from "@/types/agent-orchestrator";
import { isTodoToolName, settleDanglingTodoToolMessages } from "../../agent-tool-messages";
import { runOrchestratorSideEffect } from "../support/async-side-effects";
import { finalizeDraftAssistantMessage, sanitizeStreamingText } from "../support/utils";
import type {
  DraftChannel,
  DraftChannelValueMap,
  SessionLifecycleEventContext,
  SessionPart,
  SessionPartEventContext,
} from "./session-event-types";

const DRAFT_FLUSH_DELAY_MS = 32;

export const inferToolPartStatus = (
  part: Extract<SessionPart, { kind: "tool" }>,
): Extract<SessionPart, { kind: "tool" }>["status"] => {
  return part.status;
};

export const clearDraftBuffers = (
  context: Pick<SessionLifecycleEventContext, "drafts" | "store">,
): void => {
  const timeoutId = context.drafts.draftFlushTimeoutBySessionRef?.current[context.store.sessionId];
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
  if (context.drafts.draftFlushTimeoutBySessionRef) {
    delete context.drafts.draftFlushTimeoutBySessionRef.current[context.store.sessionId];
  }
  delete context.drafts.draftRawBySessionRef.current[context.store.sessionId];
  delete context.drafts.draftSourceBySessionRef.current[context.store.sessionId];
  if (context.drafts.draftMessageIdBySessionRef) {
    delete context.drafts.draftMessageIdBySessionRef.current[context.store.sessionId];
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

export const flushDraftBuffers = (
  context: Pick<SessionLifecycleEventContext, "drafts" | "store">,
): void => {
  const timeoutId = context.drafts.draftFlushTimeoutBySessionRef?.current[context.store.sessionId];
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    if (context.drafts.draftFlushTimeoutBySessionRef) {
      delete context.drafts.draftFlushTimeoutBySessionRef.current[context.store.sessionId];
    }
  }

  const rawByChannel = context.drafts.draftRawBySessionRef.current[context.store.sessionId];
  const messageIdByChannel =
    context.drafts.draftMessageIdBySessionRef?.current[context.store.sessionId];
  const reasoningDraft = resolveDraftFieldState("reasoning", rawByChannel, messageIdByChannel);

  context.store.updateSession(
    context.store.sessionId,
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

export const scheduleDraftFlush = (
  context: Pick<SessionLifecycleEventContext, "drafts" | "store">,
): void => {
  const draftFlushTimeoutBySessionRef = context.drafts.draftFlushTimeoutBySessionRef;
  if (!draftFlushTimeoutBySessionRef) {
    flushDraftBuffers(context);
    return;
  }

  const existingTimeoutId = draftFlushTimeoutBySessionRef.current[context.store.sessionId];
  if (existingTimeoutId !== undefined) {
    clearTimeout(existingTimeoutId);
  }

  draftFlushTimeoutBySessionRef.current[context.store.sessionId] = setTimeout(() => {
    delete draftFlushTimeoutBySessionRef.current[context.store.sessionId];
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
  return input ? Object.values(input).some((value) => hasMeaningfulToolInputValue(value)) : false;
};

const shouldClearTurnFromCurrentState = (current: AgentSessionState): boolean => {
  return (
    (current.draftAssistantText.trim().length > 0 ||
      current.draftReasoningText.trim().length > 0) &&
    current.pendingPermissions.length === 0 &&
    current.pendingQuestions.length === 0
  );
};

export const settleDraftToIdle = (
  context: Pick<SessionLifecycleEventContext, "store" | "turn">,
  timestamp: string,
): boolean => {
  let shouldClear = false;
  context.store.updateSession(context.store.sessionId, (current) => {
    const finalized = finalizeDraftAssistantMessage(
      current,
      timestamp,
      context.turn.resolveTurnDurationMs(context.store.sessionId, timestamp, current.messages),
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

export const refreshTodosFromSessionRef = (
  context: Pick<SessionPartEventContext, "store" | "refresh">,
): void => {
  const session = context.store.sessionsRef.current[context.store.sessionId];
  if (!session) {
    return;
  }
  const runtimeKind = session.runtimeKind ?? session.selectedModel?.runtimeKind;
  if (!runtimeKind) {
    throw new Error(
      `Runtime kind is required to refresh todos for session '${context.store.sessionId}'.`,
    );
  }
  runOrchestratorSideEffect(
    "session-events-refresh-todos",
    context.refresh.loadSessionTodos(
      context.store.sessionId,
      runtimeKind,
      {
        endpoint: session.runtimeEndpoint,
        workingDirectory: session.workingDirectory,
      },
      session.externalSessionId,
    ),
    {
      tags: {
        repoPath: context.refresh.repoPath,
        sessionId: context.store.sessionId,
        taskId: session.taskId,
        role: session.role,
        externalSessionId: session.externalSessionId,
      },
    },
  );
};
