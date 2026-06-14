import type { AgentRole } from "@openducktor/core";
import { isReadOnlyAgentRole } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import {
  getAgentSession,
  getAgentSessionByExternalSessionId,
} from "@/state/agent-session-collection";
import type {
  AgentApprovalRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
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
type PendingInputRequiredEvent = ApprovalRequiredEvent | QuestionRequiredEvent;
type PendingInputRoute =
  | {
      kind: "active_child_listener";
      shouldPatchParentLink: boolean;
    }
  | {
      kind: "session";
      shouldPatchParentLink: boolean;
      targetSession: AgentSessionIdentity | null;
    };

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

const resolveLoadedSessionByExternalId = (
  context: Pick<SessionLifecycleEventContext, "store">,
  externalSessionId: string,
): AgentSessionState | null =>
  getAgentSessionByExternalSessionId(context.store.sessionsRef.current, externalSessionId);

const resolvePermissionPolicyRole = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: ApprovalRequiredEvent,
): AgentRole | undefined => {
  if (event.parentExternalSessionId) {
    const parentRole = getAgentSessionByExternalSessionId(
      context.store.sessionsRef.current,
      event.parentExternalSessionId,
    )?.role;
    if (parentRole) {
      return parentRole;
    }
  }

  return (
    getAgentSession(context.store.sessionsRef.current, context.store.sessionIdentity)?.role ??
    undefined
  );
};

const resolveSubagentMessageForSessionLink = (
  current: AgentSessionState,
  event: PendingInputRequiredEvent,
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
  event: PendingInputRequiredEvent,
): void => {
  if (!event.parentExternalSessionId) {
    return;
  }
  const childExternalSessionId = event.childExternalSessionId?.trim();
  if (!childExternalSessionId) {
    return;
  }
  const parentSession = resolveLoadedSessionByExternalId(context, event.parentExternalSessionId);
  if (!parentSession) {
    return;
  }

  context.store.updateSession(
    parentSession,
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
  event: PendingInputRequiredEvent,
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
  targetSession: AgentSessionIdentity | null,
  event: ApprovalRequiredEvent,
): void => {
  if (!targetSession) {
    return;
  }
  context.store.updateSession(
    targetSession,
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
  targetSession: AgentSessionIdentity | null,
  event: QuestionRequiredEvent,
): void => {
  if (!targetSession) {
    return;
  }
  context.store.updateSession(
    targetSession,
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

  const session = getAgentSession(context.store.sessionsRef.current, context.store.sessionIdentity);
  if (!session?.runtimeKind || !context.approvals.resolveRuntimeDefinition) {
    return false;
  }
  const runtimeDefinition = context.approvals.resolveRuntimeDefinition(session.runtimeKind);
  return runtimeDefinition?.capabilities.approvals.readOnlyAutoRejectSafe === true;
};

const isLinkedChildOwnedByActiveListener = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: PendingInputRequiredEvent,
): boolean => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  if (!childExternalSessionId || !context.store.isSessionListenerActive) {
    return false;
  }

  return context.store.isSessionListenerActive(childExternalSessionId);
};

const resolvePendingInputRoute = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: PendingInputRequiredEvent,
): PendingInputRoute => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  const shouldPatchParentLink = Boolean(event.parentExternalSessionId && childExternalSessionId);

  if (!isLinkedChildObservedByParent(context, event)) {
    return {
      kind: "session",
      shouldPatchParentLink,
      targetSession: context.store.sessionIdentity,
    };
  }

  if (isLinkedChildOwnedByActiveListener(context, event)) {
    return {
      kind: "active_child_listener",
      shouldPatchParentLink,
    };
  }

  return {
    kind: "session",
    shouldPatchParentLink,
    targetSession: childExternalSessionId
      ? resolveLoadedSessionByExternalId(context, childExternalSessionId)
      : context.store.sessionIdentity,
  };
};

const autoRejectMutatingApproval = (
  context: SessionLifecycleEventContext,
  event: ApprovalRequiredEvent,
  role: AgentRole,
  {
    pendingSession,
    replySession = context.store.sessionIdentity,
  }: {
    pendingSession: AgentSessionIdentity | null;
    replySession?: AgentSessionIdentity;
  },
): void => {
  const pendingApproval = toPendingApproval(event);
  const markManualResponseRequired = (error: unknown): void => {
    const manualResponseSession =
      pendingSession && getAgentSession(context.store.sessionsRef.current, pendingSession) !== null
        ? pendingSession
        : replySession;
    context.store.updateSession(
      manualResponseSession,
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

  const loadedReplySession = getAgentSession(context.store.sessionsRef.current, replySession);
  if (!loadedReplySession) {
    markManualResponseRequired(
      new Error(`Session '${replySession.externalSessionId}' is not loaded.`),
    );
    return;
  }

  let replyTarget: ReturnType<typeof toRuntimeSessionContextRef>;
  try {
    replyTarget = toRuntimeSessionContextRef(
      context.runtimeData.sessionRef.repoPath,
      loadedReplySession,
    );
  } catch (error) {
    markManualResponseRequired(error);
    return;
  }

  void context.approvals
    .buildReadOnlyApprovalRejectionMessage(role)
    .then((rejectionMessage) =>
      context.approvals.adapter.replyApproval({
        ...replyTarget,
        requestId: event.requestId,
        outcome: "reject",
        message: rejectionMessage,
      }),
    )
    .then(() => {
      if (!pendingSession) {
        return;
      }
      context.store.updateSession(
        pendingSession,
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
  const route = resolvePendingInputRoute(context, event);

  if (route.shouldPatchParentLink) {
    patchParentSubagentSessionLink(context, event);
  }
  if (route.kind === "active_child_listener") {
    return;
  }

  if (role && shouldAutoRejectApproval(context, role, event)) {
    recordSessionPendingApproval(context, route.targetSession, event);
    autoRejectMutatingApproval(context, event, role, {
      pendingSession: route.targetSession,
    });
    return;
  }

  recordSessionPendingApproval(context, route.targetSession, event);
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
  const targetSession = resolveLoadedSessionByExternalId(context, targetSessionId);
  if (!targetSession) {
    return;
  }

  context.store.updateSession(
    targetSession,
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
  const route = resolvePendingInputRoute(context, event);

  if (route.shouldPatchParentLink) {
    patchParentSubagentSessionLink(context, event);
  }
  if (route.kind === "active_child_listener") {
    return;
  }

  recordSessionPendingQuestion(context, route.targetSession, event);
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
  const targetSession = resolveLoadedSessionByExternalId(context, targetSessionId);
  if (!targetSession) {
    return;
  }

  context.store.updateSession(
    targetSession,
    (current) => ({
      ...current,
      pendingQuestions: current.pendingQuestions.filter(
        (entry) => entry.requestId !== event.requestId,
      ),
    }),
    { persist: false },
  );
};
