import type { AgentSessionState } from "@/types/agent-orchestrator";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import { toAssistantMessageMeta, toSessionContextUsage } from "../support/assistant-meta";
import {
  appendSessionMessage,
  createSessionMessagesState,
  upsertSessionMessage,
  upsertUserSessionMessage,
} from "../support/messages";
import {
  buildSessionCompactedNoticeMessage,
  buildSessionCompactionStartedNoticeMessage,
  buildSessionErrorNoticeMessage,
  buildUserStoppedNoticeMessage,
  removeRunningSessionCompactionNotices,
  USER_STOPPED_NOTICE,
} from "../support/session-notice-messages";
import { mergeTodoListPreservingOrder } from "../support/todos";
import {
  isStopAbortSessionErrorMessage,
  normalizeRetryStatusMessage,
  normalizeSessionErrorMessage,
} from "../support/tool-messages";
import { toUserChatMessage } from "../support/user-message-event";
import type { SessionEvent, SessionLifecycleEventContext } from "./session-event-types";
import { settleSessionToIdle } from "./session-helpers";

const clearTurnTracking = (
  context: Pick<SessionLifecycleEventContext, "session" | "turn" | "store">,
): void => {
  context.turn.turnMetadata.clearSession(context.session.key);
};

const nextContextUsageWasEstablishedForMessage = (
  context: Pick<SessionLifecycleEventContext, "session" | "turn" | "store">,
  messageId: string,
): boolean => {
  return context.turn.turnMetadata.hasContextUsageMessageId(context.session.key, messageId);
};

type AssistantMessageEvent = Extract<SessionEvent, { type: "assistant_message" }>;

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
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: Extract<SessionEvent, { type: "session_started" }>,
): void => {
  context.store.updateSession(context.session.identity, (current) => ({
    ...current,
    status: "running",
    runtimeStatusMessage: null,
    messages: appendSessionMessage(current, {
      id: crypto.randomUUID(),
      role: "system",
      content: event.message,
      timestamp: event.timestamp,
    }),
  }));
};

export const handleAssistantMessage = (
  context: Pick<SessionLifecycleEventContext, "session" | "store" | "turn">,
  event: AssistantMessageEvent,
): void => {
  context.store.updateSession(context.session.identity, (current) => {
    const settledMessages = settleDanglingTodoToolMessages(current, event.timestamp);
    const durationMs =
      event.durationMs ??
      context.turn.resolveTurnDurationMs(
        context.session.key,
        context.session.identity.externalSessionId,
        event.timestamp,
        settledMessages,
      );
    const shouldPreserveContextUsage =
      nextContextUsageWasEstablishedForMessage(context, event.messageId) &&
      current.contextUsage !== null;
    const model = event.model ?? context.turn.turnMetadata.readModel(context.session.key) ?? null;
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
      messages: upsertSessionMessage(
        {
          externalSessionId: current.externalSessionId,
          messages: settledMessages,
        },
        nextSnapshot.assistantMessage,
      ),
    };
  });
  context.turn.clearTurnDuration(context.session.key, event.timestamp);
  clearTurnTracking(context);
};

export const handleTranscriptRetracted = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: Extract<SessionEvent, { type: "transcript_retracted" }>,
): void => {
  const retractedMessageIds = new Set(event.messageIds);
  const belongsToRetractedMessage = (messageId: string): boolean => {
    for (const retractedMessageId of retractedMessageIds) {
      if (
        messageId === retractedMessageId ||
        messageId.startsWith(`thinking:${retractedMessageId}:`) ||
        messageId.startsWith(`tool:${retractedMessageId}:`)
      ) {
        return true;
      }
    }
    return false;
  };
  context.store.updateSession(context.session.identity, (current) => ({
    ...current,
    messages: createSessionMessagesState(
      current.externalSessionId,
      current.messages.items.filter((message) => !belongsToRetractedMessage(message.id)),
      current.messages.version + 1,
    ),
  }));
};

export const handleUserMessage = (
  context: Pick<SessionLifecycleEventContext, "session" | "store" | "turn">,
  event: Extract<SessionEvent, { type: "user_message" }>,
): void => {
  context.turn.recordTurnUserMessageTimestamp(context.session.key, event.timestamp);
  context.store.updateSession(context.session.identity, (current) => {
    return {
      ...current,
      runtimeStatusMessage: null,
      messages: upsertUserSessionMessage(current, toUserChatMessage(event)),
    };
  });
};

export const handleSessionStatus = (
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "session_status" }>,
): void => {
  const status = event.status;

  if (status.type === "busy") {
    context.turn.recordTurnActivityTimestamp(context.session.key, event.timestamp);
    context.store.updateSession(context.session.identity, (current) =>
      current.status === "error"
        ? current
        : {
            ...current,
            status: "running",
            runtimeStatusMessage: status.message,
          },
    );
    return;
  }

  if (status.type === "retry") {
    const retryMessage = normalizeRetryStatusMessage(status.message);
    context.store.updateSession(context.session.identity, (current) =>
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
    );
    return;
  }

  if (settleSessionToIdle(context, event.timestamp)) {
    context.turn.clearTurnDuration(context.session.key, event.timestamp);
    clearTurnTracking(context);
  }
};

export const handleSessionTodosUpdated = (
  context: Pick<SessionLifecycleEventContext, "session" | "store" | "todos">,
  event: Extract<SessionEvent, { type: "session_todos_updated" }>,
): void => {
  const current = context.store.readSession(context.session.identity);
  if (!current) {
    return;
  }

  context.store.updateSession(context.session.identity, (current) => ({
    ...current,
    messages: settleDanglingTodoToolMessages(current, event.timestamp),
  }));

  context.todos.updateSessionTodos(
    { ...context.session.identity, repoPath: context.session.repoPath },
    (todos) => mergeTodoListPreservingOrder(todos, event.todos),
  );
};

export const handleSessionCompacted = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: Extract<SessionEvent, { type: "session_compacted" }>,
): void => {
  const messageId = event.messageId ?? `session-compaction:${event.externalSessionId}`;
  context.store.updateSession(
    context.session.identity,
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
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: Extract<SessionEvent, { type: "session_compaction_started" }>,
): void => {
  const messageId = event.messageId ?? `session-compaction:${event.externalSessionId}`;
  context.store.updateSession(
    context.session.identity,
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
  const sessionErrorMessage = normalizeSessionErrorMessage(event.message);
  context.store.updateSession(
    context.session.identity,
    (current) => {
      const appendUserStoppedNotice =
        Boolean(current.stopRequestedAt) && isStopAbortSessionErrorMessage(sessionErrorMessage);
      return {
        ...current,
        pendingUserMessageStartedAt: undefined,
        runtimeStatusMessage: null,
        status: appendUserStoppedNotice ? "stopped" : "error",
        stopRequestedAt: null,
        pendingApprovals: [],
        pendingQuestions: [],
        messages: appendUserStoppedNotice
          ? removeRunningSessionCompactionNotices(
              settleTerminalMessages(current, event.timestamp, {
                outcome: "error",
                errorMessage: sessionErrorMessage,
                appendUserStoppedNotice: true,
              }),
            )
          : appendSessionMessage(
              {
                externalSessionId: current.externalSessionId,
                messages: removeRunningSessionCompactionNotices(
                  settleTerminalMessages(current, event.timestamp, {
                    outcome: "error",
                    errorMessage: sessionErrorMessage,
                  }),
                ),
              },
              buildSessionErrorNoticeMessage(event.timestamp, sessionErrorMessage),
            ),
      };
    },
    { persist: true },
  );
  context.turn.clearTurnDuration(context.session.key, event.timestamp);
  clearTurnTracking(context);
};

export const handleSessionIdle = (
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "session_idle" }>,
): void => {
  if (settleSessionToIdle(context, event.timestamp)) {
    context.turn.clearTurnDuration(context.session.key, event.timestamp);
    clearTurnTracking(context);
  }
};

export const handleSessionFinished = (
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "session_finished" }>,
): void => {
  context.store.updateSession(
    context.session.identity,
    (current) => {
      const appendUserStoppedNotice = Boolean(current.stopRequestedAt);
      const terminalStatus: AgentSessionState["status"] = appendUserStoppedNotice
        ? "stopped"
        : "idle";
      return {
        ...current,
        pendingUserMessageStartedAt: undefined,
        runtimeStatusMessage: null,
        messages: settleTerminalMessages(current, event.timestamp, {
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
  context.turn.clearTurnDuration(context.session.key, event.timestamp);
  clearTurnTracking(context);
};
