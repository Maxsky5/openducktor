import type { AgentRole } from "@openducktor/core";
import { buildReadOnlyPermissionRejectionMessage, isReadOnlyAgentRole } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentApprovalRequest, AgentSessionState } from "@/types/agent-orchestrator";
import { settleDanglingTodoToolMessages } from "../agent-tool-messages";
import {
  finalizeDraftAssistantMessage,
  toAssistantMessageMeta,
  toSessionContextUsage,
} from "../support/assistant-meta";
import {
  appendSessionMessage,
  findLastSessionMessageByRole,
  upsertSessionMessage,
} from "../support/messages";
import {
  buildSessionCompactedNoticeMessage,
  buildSessionErrorNoticeMessage,
  buildUserStoppedNoticeMessage,
  USER_STOPPED_NOTICE,
} from "../support/session-notice-messages";
import { clearSubagentPendingApprovalFromSessions } from "../support/subagent-approval-overlay";
import { formatSubagentContent } from "../support/subagent-messages";
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

type ApprovalRequiredEvent = Extract<SessionEvent, { type: "approval_required" }>;
type QuestionRequiredEvent = Extract<SessionEvent, { type: "question_required" }>;
type AssistantMessageEvent = Extract<SessionEvent, { type: "assistant_message" }>;

const toPendingApproval = (event: ApprovalRequiredEvent): AgentApprovalRequest => {
  const {
    type: _type,
    externalSessionId: _externalSessionId,
    timestamp: _timestamp,
    parentExternalSessionId: _parentExternalSessionId,
    childExternalSessionId: _childExternalSessionId,
    subagentCorrelationKey: _subagentCorrelationKey,
    ...approval
  } = event;
  return approval;
};

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
  event: ApprovalRequiredEvent,
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
  event: ApprovalRequiredEvent | QuestionRequiredEvent,
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
  event: ApprovalRequiredEvent,
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

const recordParentSubagentPendingApproval = (
  context: SessionLifecycleEventContext,
  event: ApprovalRequiredEvent,
): void => {
  if (!event.parentExternalSessionId) {
    return;
  }

  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  if (!childExternalSessionId) {
    return;
  }

  const pendingApproval = toPendingApproval(event);
  context.store.updateSession(
    event.parentExternalSessionId,
    (current) => {
      const currentMap = current.subagentPendingApprovalsByExternalSessionId ?? {};
      const currentEntries = currentMap[childExternalSessionId] ?? [];
      const nextEntries = [
        ...currentEntries.filter((entry) => entry.requestId !== event.requestId),
        pendingApproval,
      ];
      return {
        ...current,
        subagentPendingApprovalsByExternalSessionId: {
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

const shouldAutoRejectApproval = (
  context: SessionLifecycleEventContext,
  role: AgentRole | undefined,
  event: ApprovalRequiredEvent,
): boolean => {
  if (role === undefined || !isReadOnlyAgentRole(role) || event.mutation !== "mutating") {
    return false;
  }

  const session = context.store.sessionsRef.current[context.store.externalSessionId];
  if (!session?.runtimeKind || !context.approvals.resolveRuntimeDefinition) {
    return false;
  }
  const runtimeDefinition = context.approvals.resolveRuntimeDefinition(session.runtimeKind);
  return runtimeDefinition?.capabilities.approvals.readOnlyAutoRejectSafe === true;
};

const isLinkedChildApprovalOwnedByAttachedListener = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: ApprovalRequiredEvent,
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

const autoRejectMutatingApproval = (
  context: SessionLifecycleEventContext,
  event: ApprovalRequiredEvent,
  role: AgentRole,
  replySessionId = context.store.externalSessionId,
  overlaySessionId = replySessionId,
): void => {
  const pendingApproval = toPendingApproval(event);
  const promptOverrides =
    context.store.sessionsRef.current[event.parentExternalSessionId ?? replySessionId]
      ?.promptOverrides;
  const markManualResponseRequired = (error: unknown): void => {
    context.store.updateSession(
      replySessionId,
      (current) => ({
        ...current,
        pendingApprovals: [
          ...current.pendingApprovals.filter((entry) => entry.requestId !== event.requestId),
          pendingApproval,
        ],
        messages: appendSessionMessage(current, {
          id: crypto.randomUUID(),
          role: "system",
          content: `Automatic approval rejection failed: ${errorMessage(error)}. Manual response required.`,
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

  void context.approvals.adapter
    .replyApproval({
      externalSessionId: replySessionId,
      requestId: event.requestId,
      outcome: "reject",
      message: rejectionMessage,
    })
    .then(() => {
      context.store.updateSession(
        replySessionId,
        (current) => ({
          ...current,
          pendingApprovals: current.pendingApprovals.filter(
            (entry) => entry.requestId !== event.requestId,
          ),
          messages: appendSessionMessage(current, {
            id: crypto.randomUUID(),
            role: "system",
            content: `Auto-rejected mutating approval (${event.title}) for ${role} session.`,
            timestamp: event.timestamp,
          }),
        }),
        { persist: true },
      );
      clearSubagentPendingApprovalFromSessions({
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
  const baseContextUsage = toSessionContextUsage(current, event.totalTokens, event.model);
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
  event: ApprovalRequiredEvent,
): void => {
  flushDraftBuffers(context);
  const role = resolvePermissionPolicyRole(context, event);

  if (isLinkedChildPermissionObservedByParent(context, event)) {
    patchParentSubagentSessionLink(context, event);
    const isOwnedByAttachedListener = isLinkedChildApprovalOwnedByAttachedListener(context, event);
    if (isOwnedByAttachedListener && shouldAutoRejectApproval(context, role, event)) {
      return;
    }

    recordParentSubagentPendingApproval(context, event);
    if (isOwnedByAttachedListener) {
      return;
    }

    if (role && shouldAutoRejectApproval(context, role, event)) {
      const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
      if (childExternalSessionId) {
        autoRejectMutatingApproval(
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

  if (role && shouldAutoRejectApproval(context, role, event)) {
    patchParentSubagentSessionLink(context, event);
    recordParentSubagentPendingApproval(context, event);
    autoRejectMutatingApproval(context, event, role);
    return;
  }

  context.store.updateSession(
    context.store.externalSessionId,
    (current) => ({
      ...current,
      pendingApprovals: [
        ...current.pendingApprovals.filter((entry) => entry.requestId !== event.requestId),
        toPendingApproval(event),
      ],
    }),
    { persist: false },
  );
  patchParentSubagentSessionLink(context, event);
  recordParentSubagentPendingApproval(context, event);
};

export const handleQuestionRequired = (
  context: SessionLifecycleEventContext,
  event: QuestionRequiredEvent,
): void => {
  flushDraftBuffers(context);

  if (isLinkedChildQuestionObservedByParent(context, event)) {
    patchParentSubagentSessionLink(context, event);
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
    { persist: false },
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

export const handleSessionCompacted = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: Extract<SessionEvent, { type: "session_compacted" }>,
): void => {
  context.store.updateSession(
    context.store.externalSessionId,
    (current) => ({
      ...current,
      messages: appendSessionMessage(
        current,
        buildSessionCompactedNoticeMessage(event.timestamp, event.message),
      ),
    }),
    { persist: true },
  );
};
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
        status: "stopped",
        stopRequestedAt: null,
      };
    },
    { persist: true },
  );
  context.turn.clearTurnDuration(context.store.externalSessionId, event.timestamp);
  clearTurnTracking(context);
};
