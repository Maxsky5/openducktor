import type { AgentRole } from "@openducktor/core";
import { buildReadOnlyPermissionRejectionMessage } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { isMutatingPermission } from "../../permission-policy";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import {
  finalizeDraftAssistantMessage,
  toAssistantMessageMeta,
  toSessionContextUsage,
} from "../support/assistant-meta";
import { READ_ONLY_ROLES } from "../support/core";
import {
  appendSessionMessage,
  findLastSessionMessageByRole,
  upsertSessionMessage,
} from "../support/messages";
import { formatSubagentContent } from "../support/subagent-messages";
import { clearSubagentPendingPermissionFromSessions } from "../support/subagent-permission-overlay";
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

const clearTurnTracking = (context: Pick<SessionLifecycleEventContext, "turn" | "store">): void => {
  if (context.turn.turnModelBySessionRef) {
    delete context.turn.turnModelBySessionRef.current[context.store.externalSessionId];
  }
  if (context.turn.contextUsageMessageIdBySessionRef) {
    delete context.turn.contextUsageMessageIdBySessionRef.current[context.store.externalSessionId];
  }
};

const nextContextUsageWasEstablishedForMessage = (
  context: Pick<SessionLifecycleEventContext, "turn" | "store">,
  messageId: string,
): boolean => {
  return (
    context.turn.contextUsageMessageIdBySessionRef?.current[context.store.externalSessionId] ===
    messageId
  );
};

type PermissionRequiredEvent = Extract<SessionEvent, { type: "permission_required" }>;
type QuestionRequiredEvent = Extract<SessionEvent, { type: "question_required" }>;
type AssistantMessageEvent = Extract<SessionEvent, { type: "assistant_message" }>;

const toPendingPermission = (event: PermissionRequiredEvent) => ({
  requestId: event.requestId,
  permission: event.permission,
  patterns: event.patterns,
  ...(event.metadata ? { metadata: event.metadata } : {}),
});

const toPendingQuestion = (event: QuestionRequiredEvent) => ({
  requestId: event.requestId,
  questions: event.questions,
});

const normalizeSessionId = (externalSessionId: string | undefined): string | null => {
  const trimmed = externalSessionId?.trim();
  return trimmed ? trimmed : null;
};

const resolveLocalSessionIdByExternalId = (
  sessions: Record<string, AgentSessionState>,
  externalSessionId: string,
): string | null => {
  for (const session of Object.values(sessions)) {
    if (
      session.externalSessionId === externalSessionId ||
      session.externalSessionId === externalSessionId
    ) {
      return session.externalSessionId;
    }
  }

  return null;
};

const resolvePermissionPolicyRole = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: PermissionRequiredEvent,
): AgentRole | undefined => {
  if (event.parentExternalSessionId) {
    const parentRole = context.store.sessionsRef.current[event.parentExternalSessionId]?.role;
    if (parentRole) {
      return parentRole;
    }
  }

  return context.store.sessionsRef.current[context.store.externalSessionId]?.role ?? undefined;
};

const patchParentSubagentSessionLink = (
  context: SessionLifecycleEventContext,
  event: PermissionRequiredEvent | QuestionRequiredEvent,
): void => {
  if (!event.parentExternalSessionId || !event.subagentCorrelationKey) {
    return;
  }
  const childExternalSessionId = event.childExternalSessionId?.trim();
  if (!childExternalSessionId) {
    return;
  }

  context.store.updateSession(
    event.parentExternalSessionId,
    (current) => {
      const subagentMessage = findLastSessionMessageByRole(
        current,
        "system",
        (message) =>
          message.meta?.kind === "subagent" &&
          message.meta.correlationKey === event.subagentCorrelationKey,
      );
      if (subagentMessage?.meta?.kind !== "subagent") {
        return current;
      }
      if (subagentMessage.meta.externalSessionId === childExternalSessionId) {
        return current;
      }

      const nextMeta = {
        ...subagentMessage.meta,
        externalSessionId: childExternalSessionId,
      };
      return {
        ...current,
        messages: upsertSessionMessage(current, {
          ...subagentMessage,
          content: formatSubagentContent(nextMeta),
          meta: nextMeta,
        }),
      };
    },
    { persist: false },
  );
};

const isLinkedChildPermissionObservedByParent = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: PermissionRequiredEvent,
): boolean => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  return Boolean(
    childExternalSessionId &&
      event.parentExternalSessionId === context.store.externalSessionId &&
      childExternalSessionId !== context.store.externalSessionId,
  );
};

const isLinkedChildQuestionObservedByParent = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: QuestionRequiredEvent,
): boolean => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  return Boolean(
    childExternalSessionId &&
      event.parentExternalSessionId === context.store.externalSessionId &&
      childExternalSessionId !== context.store.externalSessionId,
  );
};

const recordParentSubagentPendingPermission = (
  context: SessionLifecycleEventContext,
  event: PermissionRequiredEvent,
): void => {
  if (!event.parentExternalSessionId) {
    return;
  }

  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  if (!childExternalSessionId) {
    return;
  }

  const pendingPermission = toPendingPermission(event);
  context.store.updateSession(
    event.parentExternalSessionId,
    (current) => {
      const currentMap = current.subagentPendingPermissionsByExternalSessionId ?? {};
      const currentEntries = currentMap[childExternalSessionId] ?? [];
      const nextEntries = [
        ...currentEntries.filter((entry) => entry.requestId !== event.requestId),
        pendingPermission,
      ];
      return {
        ...current,
        subagentPendingPermissionsByExternalSessionId: {
          ...currentMap,
          [childExternalSessionId]: nextEntries,
        },
      };
    },
    { persist: false },
  );
};

const recordParentSubagentPendingQuestion = (
  context: SessionLifecycleEventContext,
  event: QuestionRequiredEvent,
): void => {
  if (!event.parentExternalSessionId) {
    return;
  }

  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  if (!childExternalSessionId) {
    return;
  }

  const pendingQuestion = toPendingQuestion(event);
  context.store.updateSession(
    event.parentExternalSessionId,
    (current) => {
      const currentMap = current.subagentPendingQuestionsByExternalSessionId ?? {};
      const currentEntries = currentMap[childExternalSessionId] ?? [];
      const nextEntries = [
        ...currentEntries.filter((entry) => entry.requestId !== event.requestId),
        pendingQuestion,
      ];
      return {
        ...current,
        subagentPendingQuestionsByExternalSessionId: {
          ...currentMap,
          [childExternalSessionId]: nextEntries,
        },
      };
    },
    { persist: false },
  );
};

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

const isLinkedChildPermissionOwnedByAttachedListener = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: PermissionRequiredEvent,
): boolean => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  if (!childExternalSessionId || !context.store.isSessionListenerAttached) {
    return false;
  }

  const localChildSessionId = resolveLocalSessionIdByExternalId(
    context.store.sessionsRef.current,
    childExternalSessionId,
  );
  return localChildSessionId ? context.store.isSessionListenerAttached(localChildSessionId) : false;
};

const isLinkedChildQuestionOwnedByAttachedListener = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: QuestionRequiredEvent,
): boolean => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  if (!childExternalSessionId || !context.store.isSessionListenerAttached) {
    return false;
  }

  const localChildSessionId = resolveLocalSessionIdByExternalId(
    context.store.sessionsRef.current,
    childExternalSessionId,
  );
  return localChildSessionId ? context.store.isSessionListenerAttached(localChildSessionId) : false;
};

const autoRejectMutatingPermission = (
  context: SessionLifecycleEventContext,
  event: PermissionRequiredEvent,
  role: AgentRole,
  replySessionId = context.store.externalSessionId,
  overlaySessionId = replySessionId,
): void => {
  const pendingPermission = toPendingPermission(event);
  const promptOverrides =
    context.store.sessionsRef.current[event.parentExternalSessionId ?? replySessionId]
      ?.promptOverrides;
  const markManualResponseRequired = (error: unknown): void => {
    context.store.updateSession(
      replySessionId,
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
    patchParentSubagentSessionLink(context, event);
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
      externalSessionId: replySessionId,
      requestId: event.requestId,
      reply: "reject",
      message: rejectionMessage,
    })
    .then(() => {
      context.store.updateSession(
        replySessionId,
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
      clearSubagentPendingPermissionFromSessions({
        sessionsRef: context.store.sessionsRef,
        updateSession: context.store.updateSession,
        targetExternalSessionId: overlaySessionId,
        requestId: event.requestId,
      });
    })
    .catch((error) => {
      markManualResponseRequired(error);
    });
};

const resolveFinalAssistantSnapshot = ({
  current,
  durationMs,
  event,
  shouldPreserveContextUsage,
}: {
  current: AgentSessionState;
  durationMs: number | undefined;
  event: AssistantMessageEvent;
  shouldPreserveContextUsage: boolean;
}) => {
  const nextContextUsage = toSessionContextUsage(current, event.totalTokens, event.model);
  const resolvedContextUsage = shouldPreserveContextUsage
    ? (current.contextUsage ?? null)
    : nextContextUsage;

  const assistantMeta = {
    ...toAssistantMessageMeta(
      current,
      durationMs,
      event.totalTokens ?? resolvedContextUsage?.totalTokens,
      event.model,
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
  context.store.updateSession(context.store.externalSessionId, (current) => ({
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
  context.store.updateSession(context.store.externalSessionId, (current) => {
    const settledMessages = settleDanglingTodoToolMessages(current, event.timestamp);
    const durationMs = context.turn.resolveTurnDurationMs(
      context.store.externalSessionId,
      event.timestamp,
      settledMessages,
    );
    const shouldPreserveContextUsage =
      nextContextUsageWasEstablishedForMessage(context, event.messageId) &&
      current.contextUsage !== null;
    const nextSnapshot = resolveFinalAssistantSnapshot({
      current,
      durationMs,
      event,
      shouldPreserveContextUsage,
    });
    return {
      ...current,
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
  context.turn.clearTurnDuration(context.store.externalSessionId, event.timestamp);
  clearTurnTracking(context);
};

export const handleUserMessage = (
  context: Pick<SessionLifecycleEventContext, "store" | "turn">,
  event: Extract<SessionEvent, { type: "user_message" }>,
): void => {
  context.turn.recordTurnUserMessageTimestamp?.(context.store.externalSessionId, event.timestamp);
  context.store.updateSession(
    context.store.externalSessionId,
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
    context.turn.recordTurnActivityTimestamp?.(context.store.externalSessionId, event.timestamp);
    if (
      context.turn.recordTurnActivityTimestamp === undefined &&
      context.turn.turnStartedAtBySessionRef.current[context.store.externalSessionId] === undefined
    ) {
      context.turn.turnStartedAtBySessionRef.current[context.store.externalSessionId] =
        eventTimestampMs(event.timestamp);
    }
    context.store.updateSession(
      context.store.externalSessionId,
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
      context.store.externalSessionId,
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
    context.turn.clearTurnDuration(context.store.externalSessionId, event.timestamp);
    clearTurnTracking(context);
  }
};

export const handlePermissionRequired = (
  context: SessionLifecycleEventContext,
  event: PermissionRequiredEvent,
): void => {
  flushDraftBuffers(context);
  const role = resolvePermissionPolicyRole(context, event);

  if (isLinkedChildPermissionObservedByParent(context, event)) {
    patchParentSubagentSessionLink(context, event);
    if (isLinkedChildPermissionOwnedByAttachedListener(context, event)) {
      return;
    }

    recordParentSubagentPendingPermission(context, event);
    if (role && shouldAutoRejectPermission(role, event)) {
      const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
      if (childExternalSessionId) {
        autoRejectMutatingPermission(
          context,
          event,
          role,
          context.store.externalSessionId,
          childExternalSessionId,
        );
      }
    }
    return;
  }

  if (role && shouldAutoRejectPermission(role, event)) {
    patchParentSubagentSessionLink(context, event);
    recordParentSubagentPendingPermission(context, event);
    autoRejectMutatingPermission(context, event, role);
    return;
  }

  context.store.updateSession(
    context.store.externalSessionId,
    (current) => ({
      ...current,
      pendingPermissions: [
        ...current.pendingPermissions.filter((entry) => entry.requestId !== event.requestId),
        toPendingPermission(event),
      ],
    }),
    { persist: true },
  );
  patchParentSubagentSessionLink(context, event);
  recordParentSubagentPendingPermission(context, event);
};

export const handleQuestionRequired = (
  context: SessionLifecycleEventContext,
  event: QuestionRequiredEvent,
): void => {
  flushDraftBuffers(context);

  if (isLinkedChildQuestionObservedByParent(context, event)) {
    patchParentSubagentSessionLink(context, event);
    if (isLinkedChildQuestionOwnedByAttachedListener(context, event)) {
      return;
    }

    recordParentSubagentPendingQuestion(context, event);
    return;
  }

  context.store.updateSession(
    context.store.externalSessionId,
    (current) => ({
      ...current,
      pendingQuestions: [
        ...current.pendingQuestions.filter((entry) => entry.requestId !== event.requestId),
        toPendingQuestion(event),
      ],
    }),
    { persist: true },
  );
  patchParentSubagentSessionLink(context, event);
  recordParentSubagentPendingQuestion(context, event);
};

export const handleSessionTodosUpdated = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: Extract<SessionEvent, { type: "session_todos_updated" }>,
): void => {
  context.store.updateSession(
    context.store.externalSessionId,
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
    "externalSessionId" | "messages"
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
    context.store.externalSessionId,
    (current) => {
      const finalized = finalizeDraftAssistantMessage(
        current,
        event.timestamp,
        context.turn.resolveTurnDurationMs(
          context.store.externalSessionId,
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
  context.turn.clearTurnDuration(context.store.externalSessionId, event.timestamp);
  clearTurnTracking(context);
};

export const handleSessionIdle = (
  context: SessionLifecycleEventContext,
  event: Extract<SessionEvent, { type: "session_idle" }>,
): void => {
  flushDraftBuffers(context);
  clearDraftBuffers(context);
  if (settleDraftToIdle(context, event.timestamp)) {
    context.turn.clearTurnDuration(context.store.externalSessionId, event.timestamp);
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
    context.store.externalSessionId,
    (current) => {
      const finalized = finalizeDraftAssistantMessage(
        current,
        event.timestamp,
        context.turn.resolveTurnDurationMs(
          context.store.externalSessionId,
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
  context.turn.clearTurnDuration(context.store.externalSessionId, event.timestamp);
  clearTurnTracking(context);
};
