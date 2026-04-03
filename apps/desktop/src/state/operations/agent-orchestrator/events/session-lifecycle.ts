import type { AgentRole } from "@openducktor/core";
import { buildReadOnlyPermissionRejectionMessage } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { isMutatingPermission } from "../../permission-policy";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import {
  finalizeDraftAssistantMessage,
  toAssistantMessageMeta,
  toSessionContextUsage,
} from "../support/assistant-meta";
import { READ_ONLY_ROLES } from "../support/core";
import { appendSessionMessage, upsertSessionMessage } from "../support/messages";
import { mergeTodoListPreservingOrder } from "../support/todos";
import {
  isStopAbortSessionErrorMessage,
  normalizeRetryStatusMessage,
  normalizeSessionErrorMessage,
} from "../support/tool-messages";
import type { SessionEvent, SessionLifecycleEventContext } from "./session-event-types";
import {
  clearDraftBuffers,
  eventTimestampMs,
  flushDraftBuffers,
  settleDraftToIdle,
} from "./session-helpers";

const clearTurnModelSnapshot = (
  context: Pick<SessionLifecycleEventContext, "turn" | "store">,
): void => {
  if (context.turn.turnModelBySessionRef) {
    delete context.turn.turnModelBySessionRef.current[context.store.sessionId];
  }
};

type PermissionRequiredEvent = Extract<SessionEvent, { type: "permission_required" }>;

const toPendingPermission = (event: PermissionRequiredEvent) => ({
  requestId: event.requestId,
  permission: event.permission,
  patterns: event.patterns,
  ...(event.metadata ? { metadata: event.metadata } : {}),
});

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

const shouldAutoRejectPermission = (
  role: AgentRole | undefined,
  event: PermissionRequiredEvent,
): boolean => {
  return (
    role !== undefined &&
    READ_ONLY_ROLES.has(role) &&
    isMutatingPermission(event.permission, event.patterns, event.metadata)
  );
};

const autoRejectMutatingPermission = (
  context: SessionLifecycleEventContext,
  event: PermissionRequiredEvent,
  role: AgentRole,
): void => {
  const pendingPermission = toPendingPermission(event);
  const promptOverrides =
    context.store.sessionsRef.current[context.store.sessionId]?.promptOverrides;
  const markManualResponseRequired = (error: unknown): void => {
    context.store.updateSession(
      context.store.sessionId,
      (current) => ({
        ...current,
        pendingPermissions: [
          ...current.pendingPermissions.filter((entry) => entry.requestId !== event.requestId),
          pendingPermission,
        ],
        messages: appendSessionMessage(current, {
          id: crypto.randomUUID(),
          role: "system",
          content: `Automatic permission rejection failed: ${errorMessage(error)}. Manual response required.`,
          timestamp: event.timestamp,
        }),
      }),
      { persist: true },
    );
  };

  let rejectionMessage: string;
  try {
    rejectionMessage = buildReadOnlyPermissionRejectionMessage({
      role,
      overrides: promptOverrides ?? {},
    });
  } catch (error) {
    markManualResponseRequired(error);
    return;
  }

  void context.permissions.adapter
    .replyPermission({
      sessionId: context.store.sessionId,
      requestId: event.requestId,
      reply: "reject",
      message: rejectionMessage,
    })
    .then(() => {
      context.store.updateSession(
        context.store.sessionId,
        (current) => ({
          ...current,
          pendingPermissions: current.pendingPermissions.filter(
            (entry) => entry.requestId !== event.requestId,
          ),
          messages: appendSessionMessage(current, {
            id: crypto.randomUUID(),
            role: "system",
            content: `Auto-rejected mutating permission (${event.permission}) for ${role} session.`,
            timestamp: event.timestamp,
          }),
        }),
        { persist: true },
      );
    })
    .catch((error) => {
      markManualResponseRequired(error);
    });
};

export const handleSessionStarted = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: Extract<SessionEvent, { type: "session_started" }>,
): void => {
  context.store.updateSession(context.store.sessionId, (current) => ({
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
  event: Extract<SessionEvent, { type: "assistant_message" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  context.store.updateSession(context.store.sessionId, (current) => {
    const settledMessages = settleDanglingTodoToolMessages(current, event.timestamp);
    const durationMs = context.turn.resolveTurnDurationMs(
      context.store.sessionId,
      event.timestamp,
      settledMessages,
    );
    const nextAssistantMessage = {
      id: event.messageId,
      role: "assistant" as const,
      content: event.message,
      timestamp: event.timestamp,
      meta: toAssistantMessageMeta(current, durationMs, event.totalTokens, event.model),
    };
    return {
      ...current,
      draftAssistantText: "",
      draftAssistantMessageId: null,
      draftReasoningText: "",
      draftReasoningMessageId: null,
      contextUsage: toSessionContextUsage(current, event.totalTokens, event.model),
      messages: upsertSessionMessage(
        {
          sessionId: current.sessionId,
          messages: settledMessages,
        },
        nextAssistantMessage,
      ),
    };
  });
  context.turn.clearTurnDuration(context.store.sessionId);
  clearTurnModelSnapshot(context);
};

export const handleUserMessage = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: Extract<SessionEvent, { type: "user_message" }>,
): void => {
  context.store.updateSession(
    context.store.sessionId,
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
    if (context.turn.turnStartedAtBySessionRef.current[context.store.sessionId] === undefined) {
      context.turn.turnStartedAtBySessionRef.current[context.store.sessionId] = eventTimestampMs(
        event.timestamp,
      );
    }
    context.store.updateSession(
      context.store.sessionId,
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
      context.store.sessionId,
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
    context.turn.clearTurnDuration(context.store.sessionId);
    clearTurnModelSnapshot(context);
  }
};

export const handlePermissionRequired = (
  context: SessionLifecycleEventContext,
  event: PermissionRequiredEvent,
): void => {
  flushDraftBuffers(context);
  const role = context.store.sessionsRef.current[context.store.sessionId]?.role;

  if (role && shouldAutoRejectPermission(role, event)) {
    autoRejectMutatingPermission(context, event, role);
    return;
  }

  context.store.updateSession(
    context.store.sessionId,
    (current) => ({
      ...current,
      pendingPermissions: [
        ...current.pendingPermissions.filter((entry) => entry.requestId !== event.requestId),
        toPendingPermission(event),
      ],
    }),
    { persist: true },
  );
};

export const handleQuestionRequired = (
  context: Pick<SessionLifecycleEventContext, "store" | "drafts">,
  event: Extract<SessionEvent, { type: "question_required" }>,
): void => {
  flushDraftBuffers(context);
  context.store.updateSession(
    context.store.sessionId,
    (current) => ({
      ...current,
      pendingQuestions: [
        ...current.pendingQuestions.filter((entry) => entry.requestId !== event.requestId),
        {
          requestId: event.requestId,
          questions: event.questions,
        },
      ],
    }),
    { persist: true },
  );
};

export const handleSessionTodosUpdated = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: Extract<SessionEvent, { type: "session_todos_updated" }>,
): void => {
  context.store.updateSession(
    context.store.sessionId,
    (current) => ({
      ...current,
      todos: mergeTodoListPreservingOrder(current.todos, event.todos),
      messages: settleDanglingTodoToolMessages(current, event.timestamp),
    }),
    { persist: false },
  );
};

const buildSessionNoticeMessage = ({
  timestamp,
  content,
  tone,
  title,
}:
  | {
      timestamp: string;
      content: string;
      tone: "cancelled";
      title: string;
    }
  | {
      timestamp: string;
      content: string;
      tone: "error";
      title: string;
    }) => ({
  id: crypto.randomUUID(),
  role: "system" as const,
  content,
  timestamp,
  meta:
    tone === "cancelled"
      ? {
          kind: "session_notice" as const,
          tone: "cancelled" as const,
          reason: "user_stopped" as const,
          title,
        }
      : {
          kind: "session_notice" as const,
          tone: "error" as const,
          reason: "session_error" as const,
          title,
        },
});

const buildUserStoppedNoticeMessage = (timestamp: string) =>
  buildSessionNoticeMessage({
    timestamp,
    content: "Session stopped at your request.",
    tone: "cancelled",
    title: "Stopped",
  });

const buildSessionErrorNoticeMessage = (timestamp: string, message: string) =>
  buildSessionNoticeMessage({
    timestamp,
    content: message,
    tone: "error",
    title: "Error",
  });

const settleTerminalMessages = (
  session: Pick<
    SessionLifecycleEventContext["store"]["sessionsRef"]["current"][string],
    "sessionId" | "messages"
  >,
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
    { sessionId: session.sessionId, messages: settledMessages },
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
    context.store.sessionId,
    (current) => {
      const finalized = finalizeDraftAssistantMessage(
        current,
        event.timestamp,
        context.turn.resolveTurnDurationMs(
          context.store.sessionId,
          event.timestamp,
          current.messages,
        ),
      );
      const appendUserStoppedNotice =
        Boolean(current.stopRequestedAt) && isStopAbortSessionErrorMessage(sessionErrorMessage);
      return {
        ...finalized,
        status: appendUserStoppedNotice ? "stopped" : "error",
        stopRequestedAt: null,
        pendingPermissions: [],
        pendingQuestions: [],
        messages: appendUserStoppedNotice
          ? settleTerminalMessages(finalized, event.timestamp, {
              outcome: "error",
              errorMessage: sessionErrorMessage,
              appendUserStoppedNotice: true,
            })
          : appendSessionMessage(
              {
                sessionId: finalized.sessionId,
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
  context.turn.clearTurnDuration(context.store.sessionId);
  clearTurnModelSnapshot(context);
};

export const handleSessionIdle = (
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "session_idle" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  if (settleDraftToIdle(context, event.timestamp)) {
    context.turn.clearTurnDuration(context.store.sessionId);
    clearTurnModelSnapshot(context);
  }
};

export const handleSessionFinished = (
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "session_finished" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  context.store.updateSession(
    context.store.sessionId,
    (current) => {
      const finalized = finalizeDraftAssistantMessage(
        current,
        event.timestamp,
        context.turn.resolveTurnDurationMs(
          context.store.sessionId,
          event.timestamp,
          current.messages,
        ),
      );
      const appendUserStoppedNotice = Boolean(current.stopRequestedAt);
      return {
        ...finalized,
        messages: settleTerminalMessages(finalized, event.timestamp, {
          ...(appendUserStoppedNotice
            ? {
                outcome: "error" as const,
                errorMessage: "Session stopped at your request.",
                appendUserStoppedNotice: true,
              }
            : {}),
        }),
        pendingPermissions: [],
        pendingQuestions: [],
        status: "stopped",
        stopRequestedAt: null,
      };
    },
    { persist: true },
  );
  context.turn.clearTurnDuration(context.store.sessionId);
  clearTurnModelSnapshot(context);
};
