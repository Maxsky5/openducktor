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
import { isDuplicateAssistantMessage, READ_ONLY_ROLES } from "../support/core";
import { upsertMessage } from "../support/messages";
import { mergeTodoListPreservingOrder } from "../support/todos";
import {
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

const findExistingAssistantMessageIndex = (
  messages: SessionLifecycleEventContext["store"]["sessionsRef"]["current"][string]["messages"],
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
      continue;
    }
    if (entry.timestamp === event.timestamp) {
      return index;
    }
    const existingEpoch = Date.parse(entry.timestamp);
    if (Number.isNaN(existingEpoch) || Number.isNaN(incomingEpoch)) {
      continue;
    }
    if (Math.abs(incomingEpoch - existingEpoch) <= 2_000) {
      return index;
    }
  }

  return -1;
};

const toUserMessageMeta = (model: Extract<SessionEvent, { type: "user_message" }>["model"]) => {
  if (!model) {
    return undefined;
  }

  return {
    kind: "user" as const,
    ...(model.providerId ? { providerId: model.providerId } : {}),
    ...(model.modelId ? { modelId: model.modelId } : {}),
    ...(model.variant ? { variant: model.variant } : {}),
    ...(model.profileId ? { profileId: model.profileId } : {}),
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
        messages: [
          ...current.messages,
          {
            id: crypto.randomUUID(),
            role: "system",
            content: `Automatic permission rejection failed: ${errorMessage(error)}. Manual response required.`,
            timestamp: event.timestamp,
          },
        ],
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
          messages: [
            ...current.messages,
            {
              id: crypto.randomUUID(),
              role: "system",
              content: `Auto-rejected mutating permission (${event.permission}) for ${role} session.`,
              timestamp: event.timestamp,
            },
          ],
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
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "assistant_message" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  context.store.updateSession(context.store.sessionId, (current) => {
    const settledMessages = settleDanglingTodoToolMessages(current.messages, event.timestamp);
    const existingMessageIndex = findExistingAssistantMessageIndex(settledMessages, event);
    const messageAlreadyPresent =
      existingMessageIndex >= 0 ||
      isDuplicateAssistantMessage(settledMessages, event.message, event.timestamp);
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
      messages: messageAlreadyPresent
        ? existingMessageIndex >= 0
          ? settledMessages.map((entry, index) =>
              index === existingMessageIndex ? { ...entry, ...nextAssistantMessage } : entry,
            )
          : settledMessages
        : [...settledMessages, nextAssistantMessage],
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
      const userMessageMeta = toUserMessageMeta(event.model);
      return {
        ...current,
        messages: upsertMessage(current.messages, {
          id: event.messageId,
          role: "user",
          content: event.message,
          timestamp: event.timestamp,
          ...(userMessageMeta ? { meta: userMessageMeta } : {}),
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
      messages: settleDanglingTodoToolMessages(current.messages, event.timestamp),
    }),
    { persist: false },
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
      return {
        ...finalized,
        messages: settleDanglingTodoToolMessages(finalized.messages, event.timestamp),
        pendingPermissions: [],
        pendingQuestions: [],
        status: "stopped",
      };
    },
    { persist: true },
  );
  context.turn.clearTurnDuration(context.store.sessionId);
  clearTurnModelSnapshot(context);
};
