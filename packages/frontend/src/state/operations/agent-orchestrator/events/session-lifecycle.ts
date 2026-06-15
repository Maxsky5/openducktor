import type { AgentSessionState } from "@/types/agent-orchestrator";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import {
  finalizeDraftAssistantMessage,
  toAssistantMessageMeta,
  toSessionContextUsage,
} from "../support/assistant-meta";
import { appendSessionMessage, upsertSessionMessage } from "../support/messages";
import {
  buildSessionCompactedNoticeMessage,
  buildSessionCompactionStartedNoticeMessage,
  buildSessionErrorNoticeMessage,
  buildUserStoppedNoticeMessage,
  USER_STOPPED_NOTICE,
} from "../support/session-notice-messages";
import { mergeTodoListPreservingOrder } from "../support/todos";
import {
  isStopAbortSessionErrorMessage,
  normalizeRetryStatusMessage,
  normalizeSessionErrorMessage,
} from "../support/tool-messages";
import type { SessionEvent, SessionLifecycleEventContext } from "./session-event-types";
import { clearDraftBuffers, flushDraftBuffers, settleDraftToIdle } from "./session-helpers";

const clearTurnTracking = (context: Pick<SessionLifecycleEventContext, "turn" | "store">): void => {
  context.turn.turnMetadata.clearSession(context.store.sessionKey);
};

const nextContextUsageWasEstablishedForMessage = (
  context: Pick<SessionLifecycleEventContext, "turn" | "store">,
  messageId: string,
): boolean => {
  return context.turn.turnMetadata.hasContextUsageMessageId(context.store.sessionKey, messageId);
};

type AssistantMessageEvent = Extract<SessionEvent, { type: "assistant_message" }>;

const toUserMessageMeta = (event: Extract<SessionEvent, { type: "user_message" }>) => {
  const model = event.model;
  const parts = Array.isArray(event.parts) ? event.parts : [];
  return {
    kind: "user" as const,
    state: event.state,
    ...(model?.providerId ? { providerId: model.providerId } : {}),
    ...(model?.modelId ? { modelId: model.modelId } : {}),
    ...(model?.variant ? { variant: model.variant } : {}),
    ...(model?.profileId ? { profileId: model.profileId } : {}),
    ...(parts.length > 0 ? { parts } : {}),
  };
};

const resolveFinalAssistantSnapshot = ({
  current,
  durationMs,
  event,
  model,
  shouldPreserveContextUsage,
}: {
  current: AgentSessionState;
  durationMs: number | undefined;
  event: AssistantMessageEvent;
  model: AgentSessionState["selectedModel"] | null;
  shouldPreserveContextUsage: boolean;
}) => {
  const baseContextUsage = toSessionContextUsage(current, event.totalTokens, model ?? undefined);
  const nextContextUsage =
    baseContextUsage && typeof event.contextWindow === "number"
      ? { ...baseContextUsage, contextWindow: event.contextWindow }
      : baseContextUsage;
  const resolvedContextUsage = shouldPreserveContextUsage
    ? (current.contextUsage ?? null)
    : nextContextUsage;

  const assistantMeta = {
    ...toAssistantMessageMeta(
      current,
      durationMs,
      event.totalTokens ?? resolvedContextUsage?.totalTokens,
      model ?? undefined,
    ),
  };
  if (typeof resolvedContextUsage?.contextWindow === "number") {
    assistantMeta.contextWindow = resolvedContextUsage.contextWindow;
  }
  if (typeof resolvedContextUsage?.outputLimit === "number") {
    assistantMeta.outputLimit = resolvedContextUsage.outputLimit;
  }

  return {
    contextUsage: resolvedContextUsage,
    assistantMessage: {
      id: event.messageId,
      role: "assistant" as const,
      content: event.message,
      timestamp: event.timestamp,
      meta: assistantMeta,
    },
  };
};

export const handleSessionStarted = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: Extract<SessionEvent, { type: "session_started" }>,
): void => {
  context.store.updateSession(context.store.sessionIdentity, (current) => ({
    ...current,
    status: "running",
    messages: appendSessionMessage(current, {
      id: crypto.randomUUID(),
      role: "system",
      content: event.message,
      timestamp: event.timestamp,
    }),
  }));
};

export const handleAssistantMessage = (
  context: SessionLifecycleEventContext,
  event: AssistantMessageEvent,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  context.store.updateSession(context.store.sessionIdentity, (current) => {
    const settledMessages = settleDanglingTodoToolMessages(current, event.timestamp);
    const durationMs = context.turn.resolveTurnDurationMs(
      context.store.sessionKey,
      context.store.externalSessionId,
      event.timestamp,
      settledMessages,
    );
    const shouldPreserveContextUsage =
      nextContextUsageWasEstablishedForMessage(context, event.messageId) &&
      current.contextUsage !== null;
    const model =
      event.model ?? context.turn.turnMetadata.readModel(context.store.sessionKey) ?? null;
    const nextSnapshot = resolveFinalAssistantSnapshot({
      current,
      durationMs,
      event,
      model,
      shouldPreserveContextUsage,
    });
    return {
      ...current,
      pendingUserMessageStartedAt: undefined,
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      contextUsage: nextSnapshot.contextUsage,
      messages: upsertSessionMessage(
        {
          externalSessionId: current.externalSessionId,
          messages: settledMessages,
        },
        nextSnapshot.assistantMessage,
      ),
    };
  });
  context.turn.clearTurnDuration(context.store.sessionKey, event.timestamp);
  clearTurnTracking(context);
};

export const handleUserMessage = (
  context: Pick<SessionLifecycleEventContext, "store" | "turn">,
  event: Extract<SessionEvent, { type: "user_message" }>,
): void => {
  context.turn.recordTurnUserMessageTimestamp(context.store.sessionKey, event.timestamp);
  context.store.updateSession(
    context.store.sessionIdentity,
    (current) => {
      return {
        ...current,
        messages: upsertSessionMessage(current, {
          id: event.messageId,
          role: "user",
          content: event.message,
          timestamp: event.timestamp,
          meta: toUserMessageMeta(event),
        }),
      };
    },
    { persist: false },
  );
};

export const handleSessionStatus = (
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "session_status" }>,
): void => {
  const status = event.status;

  if (status.type === "busy") {
    context.turn.recordTurnActivityTimestamp(context.store.sessionKey, event.timestamp);
    context.store.updateSession(
      context.store.sessionIdentity,
      (current) =>
        current.status === "error"
          ? current
          : {
              ...current,
              status: "running",
            },
      { persist: false },
    );
    return;
  }

  if (status.type === "retry") {
    const retryMessage = normalizeRetryStatusMessage(status.message);
    context.store.updateSession(
      context.store.sessionIdentity,
      (current) =>
        current.status === "error"
          ? current
          : {
              ...current,
              status: "running",
              messages: upsertSessionMessage(current, {
                id: `retry:${status.attempt}`,
                role: "system",
                content: `Retry ${status.attempt}: ${retryMessage}`,
                timestamp: event.timestamp,
              }),
            },
      { persist: false },
    );
    return;
  }

  if (settleDraftToIdle(context, event.timestamp)) {
    context.turn.clearTurnDuration(context.store.sessionKey, event.timestamp);
    clearTurnTracking(context);
  }
};

export const handleSessionTodosUpdated = (
  context: Pick<SessionLifecycleEventContext, "store" | "runtimeData">,
  event: Extract<SessionEvent, { type: "session_todos_updated" }>,
): void => {
  const current = context.store.readSession(context.store.sessionIdentity);
  if (!current) {
    return;
  }

  context.runtimeData.updateSessionTodos((todos) =>
    mergeTodoListPreservingOrder(todos, event.todos),
  );
  context.store.updateSession(
    context.store.sessionIdentity,
    (current) => ({
      ...current,
      messages: settleDanglingTodoToolMessages(current, event.timestamp),
    }),
    { persist: false },
  );
};

export const handleSessionCompacted = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: Extract<SessionEvent, { type: "session_compacted" }>,
): void => {
  const messageId = event.messageId ?? `session-compaction:${event.externalSessionId}`;
  context.store.updateSession(
    context.store.sessionIdentity,
    (current) => ({
      ...current,
      messages: upsertSessionMessage(
        current,
        buildSessionCompactedNoticeMessage(event.timestamp, event.message, messageId),
      ),
    }),
    { persist: true },
  );
};

export const handleSessionCompactionStarted = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: Extract<SessionEvent, { type: "session_compaction_started" }>,
): void => {
  const messageId = event.messageId ?? `session-compaction:${event.externalSessionId}`;
  context.store.updateSession(
    context.store.sessionIdentity,
    (current) => ({
      ...current,
      messages: upsertSessionMessage(
        current,
        buildSessionCompactionStartedNoticeMessage(event.timestamp, event.message, messageId),
      ),
    }),
    { persist: true },
  );
};

const settleTerminalMessages = (
  session: Pick<AgentSessionState, "externalSessionId" | "messages">,
  timestamp: string,
  options?: {
    outcome?: "completed" | "error";
    errorMessage?: string;
    appendUserStoppedNotice?: boolean;
  },
) => {
  const settledMessages = settleDanglingTodoToolMessages(session, timestamp, {
    ...(options?.outcome ? { outcome: options.outcome } : {}),
    ...(options?.errorMessage ? { errorMessage: options.errorMessage } : {}),
  });

  if (!options?.appendUserStoppedNotice) {
    return settledMessages;
  }

  return appendSessionMessage(
    { externalSessionId: session.externalSessionId, messages: settledMessages },
    buildUserStoppedNoticeMessage(timestamp),
  );
};

export const handleSessionError = (
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "session_error" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  const sessionErrorMessage = normalizeSessionErrorMessage(event.message);
  context.store.updateSession(
    context.store.sessionIdentity,
    (current) => {
      const finalized = finalizeDraftAssistantMessage(
        current,
        event.timestamp,
        context.turn.resolveTurnDurationMs(
          context.store.sessionKey,
          context.store.externalSessionId,
          event.timestamp,
          current.messages,
        ),
        undefined,
        context.turn.turnMetadata.readModel(context.store.sessionKey) ?? undefined,
      );
      const appendUserStoppedNotice =
        Boolean(current.stopRequestedAt) && isStopAbortSessionErrorMessage(sessionErrorMessage);
      return {
        ...finalized,
        pendingUserMessageStartedAt: undefined,
        status: appendUserStoppedNotice ? "stopped" : "error",
        stopRequestedAt: null,
        pendingApprovals: [],
        pendingQuestions: [],
        messages: appendUserStoppedNotice
          ? settleTerminalMessages(finalized, event.timestamp, {
              outcome: "error",
              errorMessage: sessionErrorMessage,
              appendUserStoppedNotice: true,
            })
          : appendSessionMessage(
              {
                externalSessionId: finalized.externalSessionId,
                messages: settleTerminalMessages(finalized, event.timestamp, {
                  outcome: "error",
                  errorMessage: sessionErrorMessage,
                }),
              },
              buildSessionErrorNoticeMessage(event.timestamp, sessionErrorMessage),
            ),
      };
    },
    { persist: true },
  );
  context.turn.clearTurnDuration(context.store.sessionKey, event.timestamp);
  clearTurnTracking(context);
};

export const handleSessionIdle = (
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "session_idle" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  if (settleDraftToIdle(context, event.timestamp)) {
    context.turn.clearTurnDuration(context.store.sessionKey, event.timestamp);
    clearTurnTracking(context);
  }
};

export const handleSessionFinished = (
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "session_finished" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  context.store.updateSession(
    context.store.sessionIdentity,
    (current) => {
      const finalized = finalizeDraftAssistantMessage(
        current,
        event.timestamp,
        context.turn.resolveTurnDurationMs(
          context.store.sessionKey,
          context.store.externalSessionId,
          event.timestamp,
          current.messages,
        ),
        undefined,
        context.turn.turnMetadata.readModel(context.store.sessionKey) ?? undefined,
      );
      const appendUserStoppedNotice = Boolean(current.stopRequestedAt);
      const terminalStatus: AgentSessionState["status"] = appendUserStoppedNotice
        ? "stopped"
        : "idle";
      return {
        ...finalized,
        pendingUserMessageStartedAt: undefined,
        messages: settleTerminalMessages(finalized, event.timestamp, {
          ...(appendUserStoppedNotice
            ? {
                outcome: "error" as const,
                errorMessage: USER_STOPPED_NOTICE,
                appendUserStoppedNotice: true,
              }
            : {}),
        }),
        pendingApprovals: [],
        pendingQuestions: [],
        status: terminalStatus,
        stopRequestedAt: null,
      };
    },
    { persist: true },
  );
  context.turn.clearTurnDuration(context.store.sessionKey, event.timestamp);
  clearTurnTracking(context);
};
