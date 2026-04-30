import type { AgentSessionState } from "@/types/agent-orchestrator";
import { isTodoToolName, settleDanglingTodoToolMessages } from "../agent-tool-messages";
import { finalizeDraftAssistantMessage } from "../support/assistant-meta";
import { sanitizeStreamingText } from "../support/core";
import type {
  DraftChannel,
  DraftChannelValueMap,
  SessionLifecycleEventContext,
  SessionPart,
} from "./session-event-types";

const DRAFT_FLUSH_DELAY_MS = 100;
export const clearDraftBuffers = (
  context: Pick<SessionLifecycleEventContext, "drafts" | "store">,
): void => {
  const timeoutId =
    context.drafts.draftFlushTimeoutBySessionRef?.current[context.store.externalSessionId];
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }
  if (context.drafts.draftFlushTimeoutBySessionRef) {
    delete context.drafts.draftFlushTimeoutBySessionRef.current[context.store.externalSessionId];
  }
  delete context.drafts.draftRawBySessionRef.current[context.store.externalSessionId];
  delete context.drafts.draftSourceBySessionRef.current[context.store.externalSessionId];
  if (context.drafts.draftMessageIdBySessionRef) {
    delete context.drafts.draftMessageIdBySessionRef.current[context.store.externalSessionId];
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
  const timeoutId =
    context.drafts.draftFlushTimeoutBySessionRef?.current[context.store.externalSessionId];
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    if (context.drafts.draftFlushTimeoutBySessionRef) {
      delete context.drafts.draftFlushTimeoutBySessionRef.current[context.store.externalSessionId];
    }
  }

  const rawByChannel = context.drafts.draftRawBySessionRef.current[context.store.externalSessionId];
  const messageIdByChannel =
    context.drafts.draftMessageIdBySessionRef?.current[context.store.externalSessionId];
  const reasoningDraft = resolveDraftFieldState("reasoning", rawByChannel, messageIdByChannel);

  context.store.updateSession(
    context.store.externalSessionId,
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

  const existingTimeoutId = draftFlushTimeoutBySessionRef.current[context.store.externalSessionId];
  if (existingTimeoutId !== undefined) {
    clearTimeout(existingTimeoutId);
  }

  draftFlushTimeoutBySessionRef.current[context.store.externalSessionId] = setTimeout(() => {
    delete draftFlushTimeoutBySessionRef.current[context.store.externalSessionId];
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
  context.store.updateSession(context.store.externalSessionId, (current) => {
    const finalized = finalizeDraftAssistantMessage(
      current,
      timestamp,
      context.turn.resolveTurnDurationMs(
        context.store.externalSessionId,
        timestamp,
        current.messages,
      ),
    );
    shouldClear = shouldClearTurnFromCurrentState(current);
    return {
      ...finalized,
      messages: settleDanglingTodoToolMessages(finalized, timestamp),
      ...(current.status === "error" ? { status: "error" } : { status: "idle" }),
    };
  });
  return shouldClear;
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
    const settledMessages = settleDanglingTodoToolMessages(current, timestamp);
    if (settledMessages === current.messages) {
      return current;
    }
    return {
      ...current,
      messages: settledMessages,
    };
  };
};
