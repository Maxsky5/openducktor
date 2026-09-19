import { normalizeSessionErrorMessage } from "@/lib/session-error-message";
import { recordImageGenerationEnd } from "../support/image-generation-settlement";
import type {
  AgentChatMessage,
  AgentChatMessageMeta,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import { toAssistantMessageMeta, toSessionContextUsage } from "../support/assistant-meta";
import {
  appendSessionMessage,
  createSessionMessagesState,
  findLastSessionMessageByRole,
  replaceSessionMessageById,
  sessionMessageBelongsToSourceMessage,
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
} from "../support/tool-messages";
import { toUserChatMessage } from "../support/user-message-event";
import type { SessionEvent, SessionLifecycleEventContext } from "./session-event-types";
import { settleSessionToIdle } from "./session-helpers";
import {
  applyAsyncQuestionAnnotation,
  applyAsyncQuestionUserMessage,
} from "../support/async-questions";

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
    baseContextUsage && event.contextWindow !== undefined
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
  if (resolvedContextUsage?.contextWindow !== undefined) {
    assistantMeta.contextWindow = resolvedContextUsage.contextWindow;
  }
  if (resolvedContextUsage?.outputLimit !== undefined) {
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

export const handleAssistantMessage = (
  context: Pick<SessionLifecycleEventContext, "session" | "store" | "turn">,
  event: AssistantMessageEvent,
): void => {
  const asyncQuestion = event.asyncQuestion;
  if (asyncQuestion) {
    context.store.updateSession(context.session.identity, (current) => {
      const asyncState = applyAsyncQuestionAnnotation(
        {
          pendingAsyncQuestions: current.pendingAsyncQuestions ?? [],
          handledAsyncQuestionIds: current.handledAsyncQuestionIds ?? new Set(),
        },
        asyncQuestion,
      );
      if (asyncQuestion.status === "pending") {
        return { ...current, ...asyncState };
      }
      const messages =
        event.message.trim().length > 0
          ? upsertSessionMessage(current, {
              id: event.messageId,
              role: "assistant",
              content: event.message,
              timestamp: event.timestamp,
              meta: toAssistantMessageMeta(current),
            })
          : current.messages;
      return {
        ...current,
        ...asyncState,
        messages: appendSessionMessage(
          { ...current, messages },
          {
            id: `async-question-error:${event.messageId}`,
            role: "system",
            content: asyncQuestion.error,
            timestamp: event.timestamp,
          },
        ),
      };
    });
    return;
  }
  context.store.updateSession(context.session.identity, (current) => {
    const settledMessages = settleDanglingTodoToolMessages(current, event.timestamp);
    const settledOwner = {
      externalSessionId: current.externalSessionId,
      messages: settledMessages,
    };
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
    const sourceTextMessage =
      current.runtimeKind === "claude"
        ? findLastSessionMessageByRole(
            settledOwner,
            "assistant",
            (message) =>
              message.meta?.kind === "assistant" &&
              message.meta.sourceMessageId === event.messageId,
          )
        : undefined;
    let assistantMessage = nextSnapshot.assistantMessage;
    if (sourceTextMessage?.meta?.kind === "assistant") {
      const assistantMeta: Extract<AgentChatMessageMeta, { kind: "assistant" }> = {
        ...nextSnapshot.assistantMessage.meta,
        sourceMessageId: event.messageId,
      };
      if (sourceTextMessage.meta.partId) {
        assistantMeta.partId = sourceTextMessage.meta.partId;
      }
      assistantMessage = {
        ...nextSnapshot.assistantMessage,
        id: sourceTextMessage.id,
        meta: assistantMeta,
      };
    }
    return {
      ...current,
      messages: sourceTextMessage
        ? replaceSessionMessageById(settledOwner, sourceTextMessage.id, assistantMessage)
        : upsertSessionMessage(settledOwner, assistantMessage),
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
  const belongsToRetractedMessage = (message: AgentChatMessage): boolean => {
    for (const retractedMessageId of retractedMessageIds) {
      if (sessionMessageBelongsToSourceMessage(message, retractedMessageId)) {
        return true;
      }
    }
    return false;
  };
  context.store.updateSession(context.session.identity, (current) => ({
    ...current,
    messages: createSessionMessagesState(
      current.externalSessionId,
      current.messages.items.filter((message) => !belongsToRetractedMessage(message)),
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
    const asyncState = applyAsyncQuestionUserMessage(
      {
        pendingAsyncQuestions: current.pendingAsyncQuestions ?? [],
        handledAsyncQuestionIds: current.handledAsyncQuestionIds ?? new Set(),
        asyncQuestionSkipRevision: current.asyncQuestionSkipRevision,
      },
      event.asyncQuestionReplies,
    );
    return {
      ...current,
      ...asyncState,
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
    return;
  }

  if (status.type === "retry") {
    const retryMessage = normalizeRetryStatusMessage(status.message);
    context.store.updateSession(context.session.identity, (current) => ({
      ...current,
      messages: upsertSessionMessage(current, {
        id: `retry:${status.attempt}`,
        role: "system",
        content: `Retry ${status.attempt}: ${retryMessage}`,
        timestamp: event.timestamp,
      }),
    }));
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
  context.store.updateSession(context.session.identity, (current) => ({
    ...current,
    messages: upsertSessionMessage(
      current,
      buildSessionCompactedNoticeMessage(event.timestamp, event.message, messageId),
    ),
  }));
};

export const handleSessionCompactionStarted = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: Extract<SessionEvent, { type: "session_compaction_started" }>,
): void => {
  const messageId = event.messageId ?? `session-compaction:${event.externalSessionId}`;
  context.store.updateSession(context.session.identity, (current) => ({
    ...current,
    messages: upsertSessionMessage(
      current,
      buildSessionCompactionStartedNoticeMessage(event.timestamp, event.message, messageId),
    ),
  }));
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
  const settleOptions: Parameters<typeof settleDanglingTodoToolMessages>[2] = {};
  if (options?.outcome) {
    settleOptions.outcome = options.outcome;
  }
  if (options?.errorMessage) {
    settleOptions.errorMessage = options.errorMessage;
  }
  const settledMessages = settleDanglingTodoToolMessages(session, timestamp, settleOptions);

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
  const sessionBeforeUpdate = context.store.readSession(context.session.identity);
  const userStopAborted =
    Boolean(sessionBeforeUpdate?.stopRequestedAt) &&
    isStopAbortSessionErrorMessage(sessionErrorMessage);
  context.store.updateSession(context.session.identity, (previous) => {
    const current = recordImageGenerationEnd(previous, event.timestamp, "runtime_failure");
    return {
      ...current,
      stopRequestedAt: null,
      messages: userStopAborted
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
  });
  context.turn.clearTurnDuration(context.session.key, event.timestamp);
  clearTurnTracking(context);
};

export const handleTurnError = (
  context: Pick<SessionLifecycleEventContext, "session" | "store" | "turn">,
  event: Extract<SessionEvent, { type: "turn_error" }>,
): void => {
  const message = normalizeSessionErrorMessage(event.message);
  context.store.updateSession(context.session.identity, (previous) => {
    const current = recordImageGenerationEnd(previous, event.timestamp, "runtime_failure");
    return {
      ...current,
      messages: appendSessionMessage(
        {
          externalSessionId: current.externalSessionId,
          messages: removeRunningSessionCompactionNotices(
            settleTerminalMessages(current, event.timestamp, {
              outcome: "error",
              errorMessage: message,
            }),
          ),
        },
        buildSessionErrorNoticeMessage(event.timestamp, message, event.messageId),
      ),
    };
  });
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
  context.store.updateSession(context.session.identity, (previous) => {
    const current = recordImageGenerationEnd(previous, event.timestamp, "turn_ended");
    const appendUserStoppedNotice = Boolean(current.stopRequestedAt);
    return {
      ...current,
      messages: settleTerminalMessages(
        current,
        event.timestamp,
        appendUserStoppedNotice
          ? {
              outcome: "error" as const,
              errorMessage: USER_STOPPED_NOTICE,
              appendUserStoppedNotice: true,
            }
          : {},
      ),
      stopRequestedAt: null,
    };
  });
  context.turn.clearTurnDuration(context.session.key, event.timestamp);
  clearTurnTracking(context);
};
