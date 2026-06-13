import type { AgentRole } from "@openducktor/core";
import { buildReadOnlyPermissionRejectionMessage, isReadOnlyAgentRole } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentApprovalRequest, AgentSessionState } from "@/types/agent-orchestrator";
import {
  appendSessionMessage,
  findLastSessionMessageByRole,
  upsertSessionMessage,
} from "../support/messages";
import { toRuntimeSessionContextRef } from "../support/session-runtime-ref";
import { formatSubagentContent } from "../support/subagent-messages";
import type { SessionEvent, SessionLifecycleEventContext } from "./session-event-types";
import { flushDraftBuffers } from "./session-helpers";

type ApprovalRequiredEvent = Extract<SessionEvent, { type: "approval_required" }>;
type ApprovalResolvedEvent = Extract<SessionEvent, { type: "approval_resolved" }>;
type QuestionRequiredEvent = Extract<SessionEvent, { type: "question_required" }>;
type QuestionResolvedEvent = Extract<SessionEvent, { type: "question_resolved" }>;

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
    if (session.externalSessionId === externalSessionId) {
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

const resolveSubagentMessageForSessionLink = (
  current: AgentSessionState,
  event: ApprovalRequiredEvent | QuestionRequiredEvent,
) => {
  if (event.subagentCorrelationKey) {
    return findLastSessionMessageByRole(
      current,
      "system",
      (message) =>
        message.meta?.kind === "subagent" &&
        message.meta.correlationKey === event.subagentCorrelationKey,
    );
  }

  return undefined;
};

const patchParentSubagentSessionLink = (
  context: SessionLifecycleEventContext,
  event: ApprovalRequiredEvent | QuestionRequiredEvent,
): void => {
  if (!event.parentExternalSessionId) {
    return;
  }
  const childExternalSessionId = event.childExternalSessionId?.trim();
  if (!childExternalSessionId) {
    return;
  }

  context.store.updateSession(
    event.parentExternalSessionId,
    (current) => {
      const subagentMessage = resolveSubagentMessageForSessionLink(current, event);
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

const isLinkedChildObservedByParent = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: ApprovalRequiredEvent | QuestionRequiredEvent,
): boolean => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  return Boolean(
    childExternalSessionId &&
      event.parentExternalSessionId === context.store.externalSessionId &&
      childExternalSessionId !== context.store.externalSessionId,
  );
};

const recordSessionPendingApproval = (
  context: SessionLifecycleEventContext,
  externalSessionId: string,
  event: ApprovalRequiredEvent,
): void => {
  context.store.updateSession(
    externalSessionId,
    (current) => ({
      ...current,
      pendingApprovals: [
        ...current.pendingApprovals.filter((entry) => entry.requestId !== event.requestId),
        toPendingApproval(event),
      ],
    }),
    { persist: false },
  );
};

const recordSessionPendingQuestion = (
  context: SessionLifecycleEventContext,
  externalSessionId: string,
  event: QuestionRequiredEvent,
): void => {
  context.store.updateSession(
    externalSessionId,
    (current) => ({
      ...current,
      pendingQuestions: [
        ...current.pendingQuestions.filter((entry) => entry.requestId !== event.requestId),
        toPendingQuestion(event),
      ],
    }),
    { persist: false },
  );
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

const isLinkedChildOwnedByActiveListener = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: ApprovalRequiredEvent | QuestionRequiredEvent,
): boolean => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  if (!childExternalSessionId || !context.store.isSessionListenerActive) {
    return false;
  }

  const localChildSessionId = resolveLocalSessionIdByExternalId(
    context.store.sessionsRef.current,
    childExternalSessionId,
  );
  return localChildSessionId ? context.store.isSessionListenerActive(localChildSessionId) : false;
};

const autoRejectMutatingApproval = (
  context: SessionLifecycleEventContext,
  event: ApprovalRequiredEvent,
  role: AgentRole,
  replySessionId = context.store.externalSessionId,
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

  const replySession = context.store.sessionsRef.current[replySessionId];
  if (!replySession) {
    markManualResponseRequired(new Error(`Session '${replySessionId}' is not loaded.`));
    return;
  }

  void context.approvals.adapter
    .replyApproval({
      ...toRuntimeSessionContextRef(context.runtimeData.sessionRef.repoPath, replySession),
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
    })
    .catch((error) => {
      markManualResponseRequired(error);
    });
};

export const handlePermissionRequired = (
  context: SessionLifecycleEventContext,
  event: ApprovalRequiredEvent,
): void => {
  flushDraftBuffers(context);
  const role = resolvePermissionPolicyRole(context, event);

  if (isLinkedChildObservedByParent(context, event)) {
    patchParentSubagentSessionLink(context, event);
    const isOwnedByActiveListener = isLinkedChildOwnedByActiveListener(context, event);
    if (isOwnedByActiveListener) {
      return;
    }

    if (role && shouldAutoRejectApproval(context, role, event)) {
      autoRejectMutatingApproval(context, event, role);
      return;
    }

    const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
    if (childExternalSessionId) {
      recordSessionPendingApproval(context, childExternalSessionId, event);
    }
    return;
  }

  if (role && shouldAutoRejectApproval(context, role, event)) {
    patchParentSubagentSessionLink(context, event);
    autoRejectMutatingApproval(context, event, role);
    return;
  }

  recordSessionPendingApproval(context, context.store.externalSessionId, event);
  patchParentSubagentSessionLink(context, event);
};

export const handlePermissionResolved = (
  context: SessionLifecycleEventContext,
  event: ApprovalResolvedEvent,
): void => {
  const targetSessionId =
    normalizeSessionId(event.childExternalSessionId) ?? normalizeSessionId(event.externalSessionId);
  if (!targetSessionId) {
    return;
  }

  context.store.updateSession(
    targetSessionId,
    (current) => ({
      ...current,
      pendingApprovals: current.pendingApprovals.filter(
        (entry) => entry.requestId !== event.requestId,
      ),
    }),
    { persist: false },
  );
};

export const handleQuestionRequired = (
  context: SessionLifecycleEventContext,
  event: QuestionRequiredEvent,
): void => {
  flushDraftBuffers(context);

  if (isLinkedChildObservedByParent(context, event)) {
    patchParentSubagentSessionLink(context, event);
    if (isLinkedChildOwnedByActiveListener(context, event)) {
      return;
    }
    const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
    if (childExternalSessionId) {
      recordSessionPendingQuestion(context, childExternalSessionId, event);
    }
    return;
  }

  recordSessionPendingQuestion(context, context.store.externalSessionId, event);
  patchParentSubagentSessionLink(context, event);
};

export const handleQuestionResolved = (
  context: SessionLifecycleEventContext,
  event: QuestionResolvedEvent,
): void => {
  const targetSessionId =
    normalizeSessionId(event.childExternalSessionId) ?? normalizeSessionId(event.externalSessionId);
  if (!targetSessionId) {
    return;
  }

  context.store.updateSession(
    targetSessionId,
    (current) => ({
      ...current,
      pendingQuestions: current.pendingQuestions.filter(
        (entry) => entry.requestId !== event.requestId,
      ),
    }),
    { persist: false },
  );
};
