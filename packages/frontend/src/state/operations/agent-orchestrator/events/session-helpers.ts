import type { AgentSessionState } from "@/types/agent-orchestrator";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import { finalizeDraftAssistantMessage } from "../support/assistant-meta";
import { sanitizeStreamingText } from "../support/core";
import type {
  DraftChannel,
  SessionLifecycleEventContext,
  SessionPart,
} from "./session-event-types";

const DRAFT_FLUSH_DELAY_MS = 100;
export const clearDraftBuffers = (
  context: Pick<SessionLifecycleEventContext, "drafts" | "store">,
): void => {
  context.drafts.buffers.clearSession(context.store.sessionKey);
};

export const eventTimestampMs = (timestamp: string): number => {
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
};

const resolveDraftFieldState = (
  channel: DraftChannel,
  context: Pick<SessionLifecycleEventContext, "drafts" | "store">,
): { text: string; messageId: string | null } => {
  const draft = context.drafts.buffers.readChannel(context.store.sessionKey, channel);
  const text = sanitizeStreamingText(draft.raw);
  const messageId = text.length > 0 ? (draft.messageId ?? null) : null;
  return { text, messageId };
};

export const flushDraftBuffers = (
  context: Pick<SessionLifecycleEventContext, "drafts" | "store">,
): void => {
  context.drafts.buffers.clearFlushTimeout(context.store.sessionKey);
  const reasoningDraft = resolveDraftFieldState("reasoning", context);

  context.store.updateSession(
    context.store.sessionIdentity,
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
  context.drafts.buffers.scheduleFlush(
    context.store.sessionKey,
    () => flushDraftBuffers(context),
    DRAFT_FLUSH_DELAY_MS,
  );
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
    current.status !== "error" &&
    current.pendingApprovals.length === 0 &&
    current.pendingQuestions.length === 0
  );
};

export const settleDraftToIdle = (
  context: Pick<SessionLifecycleEventContext, "store" | "turn">,
  timestamp: string,
): boolean => {
  let shouldClear = false;
  context.store.updateSession(context.store.sessionIdentity, (current) => {
    if (current.status === "starting") {
      return current;
    }

    const durationMs = context.turn.resolveTurnDurationMs(
      context.store.sessionKey,
      context.store.externalSessionId,
      timestamp,
      current.messages,
    );
    const model = context.turn.turnMetadata.readModel(context.store.sessionKey);
    const finalized = finalizeDraftAssistantMessage(
      current,
      timestamp,
      durationMs,
      undefined,
      model ?? undefined,
    );
    shouldClear = shouldClearTurnFromCurrentState(current);
    const messages = settleDanglingTodoToolMessages(finalized, timestamp);
    const status = current.status === "error" ? "error" : "idle";
    const shouldClearPendingUserMessage =
      status === "idle" && current.pendingUserMessageStartedAt !== undefined;
    const didChange =
      finalized !== current ||
      messages !== finalized.messages ||
      current.status !== status ||
      shouldClearPendingUserMessage;
    if (!didChange) {
      return current;
    }

    return {
      ...finalized,
      messages,
      status,
      pendingUserMessageStartedAt: undefined,
    };
  });
  return shouldClear;
};

export const createPrePartTodoSettlement = (
  part: SessionPart,
  timestamp: string,
): ((current: AgentSessionState) => AgentSessionState) => {
  const shouldSettleTodoToolRows = part.kind !== "tool" || part.toolType !== "todo";
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
