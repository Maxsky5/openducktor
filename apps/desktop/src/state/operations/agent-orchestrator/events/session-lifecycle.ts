import type { AgentRole } from "@openducktor/core";
import { buildReadOnlyPermissionRejectionMessage } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { settleDanglingTodoToolMessages } from "../../agent-tool-messages";
import { isMutatingPermission } from "../../permission-policy";
import {
  finalizeDraftAssistantMessage,
  isDuplicateAssistantMessage,
  mergeTodoListPreservingOrder,
  normalizeRetryStatusMessage,
  normalizeSessionErrorMessage,
  READ_ONLY_ROLES,
  toAssistantMessageMeta,
  upsertMessage,
} from "../support/utils";
import type { SessionEvent, SessionEventContext } from "./session-event-types";
import {
  clearDraftBuffers,
  eventTimestampMs,
  flushDraftBuffers,
  settleDraftToIdle,
} from "./session-helpers";

type PermissionRequiredEvent = Extract<SessionEvent, { type: "permission_required" }>;

const toPendingPermission = (event: PermissionRequiredEvent) => ({
  requestId: event.requestId,
  permission: event.permission,
  patterns: event.patterns,
  ...(event.metadata ? { metadata: event.metadata } : {}),
});

const findExistingAssistantMessageIndex = (
  messages: SessionEventContext["sessionsRef"]["current"][string]["messages"],
  event: Extract<SessionEvent, { type: "assistant_message" }>,
): number => {
  const byIdIndex = messages.findIndex((entry) => entry.id === event.messageId);
  if (byIdIndex >= 0) {
    return byIdIndex;
  }

  const normalizedIncoming = event.message.trim();
  if (normalizedIncoming.length === 0) {
    return -1;
  }

  const incomingEpoch = Date.parse(event.timestamp);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    if (!entry || entry.role !== "assistant") {
      continue;
    }
    if (entry.content.trim() !== normalizedIncoming) {
      return -1;
    }
    if (entry.timestamp === event.timestamp) {
      return index;
    }
    const existingEpoch = Date.parse(entry.timestamp);
    if (Number.isNaN(existingEpoch) || Number.isNaN(incomingEpoch)) {
      return -1;
    }
    return Math.abs(incomingEpoch - existingEpoch) <= 2_000 ? index : -1;
  }

  return -1;
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
  context: SessionEventContext,
  event: PermissionRequiredEvent,
  role: AgentRole,
): void => {
  const pendingPermission = toPendingPermission(event);
  const promptOverrides = context.sessionsRef.current[context.sessionId]?.promptOverrides;
  const markManualResponseRequired = (error: unknown): void => {
    context.updateSession(context.sessionId, (current) => ({
      ...current,
      pendingPermissions: [
        ...current.pendingPermissions.filter((entry) => entry.requestId !== event.requestId),
        pendingPermission,
      ],
      messages: [
        ...current.messages,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `Automatic permission rejection failed: ${errorMessage(error)}. Manual response required.`,
          timestamp: event.timestamp,
        },
      ],
    }));
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

  void context.adapter
    .replyPermission({
      sessionId: context.sessionId,
      requestId: event.requestId,
      reply: "reject",
      message: rejectionMessage,
    })
    .then(() => {
      context.updateSession(context.sessionId, (current) => ({
        ...current,
        pendingPermissions: current.pendingPermissions.filter(
          (entry) => entry.requestId !== event.requestId,
        ),
        messages: [
          ...current.messages,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `Auto-rejected mutating permission (${event.permission}) for ${role} session.`,
            timestamp: event.timestamp,
          },
        ],
      }));
    })
    .catch((error) => {
      markManualResponseRequired(error);
    });
};

export const handleSessionStarted = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_started" }>,
): void => {
  context.updateSession(context.sessionId, (current) => ({
    ...current,
    status: "running",
    messages: [
      ...current.messages,
      {
        id: crypto.randomUUID(),
        role: "system",
        content: event.message,
        timestamp: event.timestamp,
      },
    ],
  }));
};

export const handleAssistantMessage = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "assistant_message" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  context.updateSession(context.sessionId, (current) => {
    const settledMessages = settleDanglingTodoToolMessages(current.messages, event.timestamp);
    const existingMessageIndex = findExistingAssistantMessageIndex(settledMessages, event);
    const messageAlreadyPresent =
      existingMessageIndex >= 0 ||
      isDuplicateAssistantMessage(settledMessages, event.message, event.timestamp);
    const durationMs = context.resolveTurnDurationMs(
      context.sessionId,
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
      messages: messageAlreadyPresent
        ? existingMessageIndex >= 0
          ? settledMessages.map((entry, index) =>
              index === existingMessageIndex ? { ...entry, ...nextAssistantMessage } : entry,
            )
          : settledMessages
        : [...settledMessages, nextAssistantMessage],
    };
  });
  context.clearTurnDuration(context.sessionId);
};

export const handleSessionStatus = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_status" }>,
): void => {
  const status = event.status;

  if (status.type === "busy") {
    if (context.turnStartedAtBySessionRef.current[context.sessionId] === undefined) {
      context.turnStartedAtBySessionRef.current[context.sessionId] = eventTimestampMs(
        event.timestamp,
      );
    }
    context.updateSession(
      context.sessionId,
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
    context.updateSession(
      context.sessionId,
      (current) =>
        current.status === "error"
          ? current
          : {
              ...current,
              status: "running",
              messages: upsertMessage(current.messages, {
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
    context.clearTurnDuration(context.sessionId);
  }
};

export const handlePermissionRequired = (
  context: SessionEventContext,
  event: PermissionRequiredEvent,
): void => {
  flushDraftBuffers(context);
  const role = context.sessionsRef.current[context.sessionId]?.role;

  if (role && shouldAutoRejectPermission(role, event)) {
    autoRejectMutatingPermission(context, event, role);
    return;
  }

  context.updateSession(context.sessionId, (current) => ({
    ...current,
    pendingPermissions: [
      ...current.pendingPermissions.filter((entry) => entry.requestId !== event.requestId),
      toPendingPermission(event),
    ],
  }));
};

export const handleQuestionRequired = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "question_required" }>,
): void => {
  flushDraftBuffers(context);
  context.updateSession(context.sessionId, (current) => ({
    ...current,
    pendingQuestions: [
      ...current.pendingQuestions.filter((entry) => entry.requestId !== event.requestId),
      {
        requestId: event.requestId,
        questions: event.questions,
      },
    ],
  }));
};

export const handleSessionTodosUpdated = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_todos_updated" }>,
): void => {
  context.updateSession(
    context.sessionId,
    (current) => ({
      ...current,
      todos: mergeTodoListPreservingOrder(current.todos, event.todos),
      messages: settleDanglingTodoToolMessages(current.messages, event.timestamp),
    }),
    { persist: false },
  );
};

export const handleSessionError = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_error" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  const sessionErrorMessage = normalizeSessionErrorMessage(event.message);
  context.updateSession(context.sessionId, (current) => {
    const finalized = finalizeDraftAssistantMessage(
      current,
      event.timestamp,
      context.resolveTurnDurationMs(context.sessionId, event.timestamp, current.messages),
    );
    const settledMessages = settleDanglingTodoToolMessages(finalized.messages, event.timestamp, {
      outcome: "error",
      errorMessage: sessionErrorMessage,
    });
    return {
      ...finalized,
      status: "error",
      pendingPermissions: [],
      pendingQuestions: [],
      messages: [
        ...settledMessages,
        {
          id: crypto.randomUUID(),
          role: "system",
          content: `Session error: ${sessionErrorMessage}`,
          timestamp: event.timestamp,
        },
      ],
    };
  });
  context.clearTurnDuration(context.sessionId);
};

export const handleSessionIdle = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_idle" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  if (settleDraftToIdle(context, event.timestamp)) {
    context.clearTurnDuration(context.sessionId);
  }
};

export const handleSessionFinished = (
  context: SessionEventContext,
  event: Extract<SessionEvent, { type: "session_finished" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  context.updateSession(context.sessionId, (current) => {
    const finalized = finalizeDraftAssistantMessage(
      current,
      event.timestamp,
      context.resolveTurnDurationMs(context.sessionId, event.timestamp, current.messages),
    );
    return {
      ...finalized,
      messages: settleDanglingTodoToolMessages(finalized.messages, event.timestamp),
      pendingPermissions: [],
      pendingQuestions: [],
      status: "stopped",
    };
  });
  context.clearTurnDuration(context.sessionId);
};
