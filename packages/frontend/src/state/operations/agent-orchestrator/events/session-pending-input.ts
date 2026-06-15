import type { AgentRole } from "@openducktor/core";
import { isReadOnlyAgentRole } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
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
type PendingInputResolvedEvent = ApprovalResolvedEvent | QuestionResolvedEvent;
type PendingInputRoute = {
  shouldPatchParentLink: boolean;
  pendingSession: AgentSessionIdentity | null;
  approvalReplySession: AgentSessionIdentity | null;
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

const upsertPendingInput = <Entry extends { requestId: string }>(
  entries: Entry[],
  nextEntry: Entry,
): Entry[] => [...entries.filter((entry) => entry.requestId !== nextEntry.requestId), nextEntry];

const removePendingInput = <Entry extends { requestId: string }>(
  entries: Entry[],
  requestId: string,
): Entry[] => entries.filter((entry) => entry.requestId !== requestId);

const normalizeSessionId = (externalSessionId: string | undefined): string | null => {
  const trimmed = externalSessionId?.trim();
  return trimmed ? trimmed : null;
};

const resolveLoadedSessionInEventRuntime = (
  context: Pick<SessionLifecycleEventContext, "store">,
  externalSessionId: string,
): AgentSessionState | null =>
  context.store.readSession({
    externalSessionId,
    runtimeKind: context.store.sessionIdentity.runtimeKind,
    workingDirectory: context.store.sessionIdentity.workingDirectory,
  });

const resolvePermissionPolicyRole = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: ApprovalRequiredEvent,
): AgentRole | undefined => {
  if (event.parentExternalSessionId) {
    const parentRole = resolveLoadedSessionInEventRuntime(
      context,
      event.parentExternalSessionId,
    )?.role;
    if (parentRole) {
      return parentRole;
    }
  }

  return context.store.readSession(context.store.sessionIdentity)?.role ?? undefined;
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
  const parentSession = resolveLoadedSessionInEventRuntime(context, event.parentExternalSessionId);
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
      pendingApprovals: upsertPendingInput(current.pendingApprovals, toPendingApproval(event)),
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
      pendingQuestions: upsertPendingInput(current.pendingQuestions, toPendingQuestion(event)),
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

  const session = context.store.readSession(context.store.sessionIdentity);
  if (!session?.runtimeKind || !context.approvals.resolveRuntimeDefinition) {
    return false;
  }
  const runtimeDefinition = context.approvals.resolveRuntimeDefinition(session.runtimeKind);
  return runtimeDefinition?.capabilities.approvals.readOnlyAutoRejectSafe === true;
};

const isLinkedChildOwnedByActiveObserver = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: PendingInputRequiredEvent,
): boolean => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  if (!childExternalSessionId || !context.store.hasSessionObserver) {
    return false;
  }

  const childSession = resolveLoadedSessionInEventRuntime(context, childExternalSessionId);
  return childSession ? context.store.hasSessionObserver(childSession) : false;
};

const resolvePendingInputRoute = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: PendingInputRequiredEvent,
): PendingInputRoute => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  const shouldPatchParentLink = Boolean(event.parentExternalSessionId && childExternalSessionId);

  if (!isLinkedChildObservedByParent(context, event)) {
    return {
      shouldPatchParentLink,
      pendingSession: context.store.sessionIdentity,
      approvalReplySession: context.store.sessionIdentity,
    };
  }

  if (isLinkedChildOwnedByActiveObserver(context, event)) {
    return {
      shouldPatchParentLink,
      pendingSession: null,
      approvalReplySession: null,
    };
  }

  return {
    shouldPatchParentLink,
    pendingSession: childExternalSessionId
      ? resolveLoadedSessionInEventRuntime(context, childExternalSessionId)
      : null,
    approvalReplySession: context.store.sessionIdentity,
  };
};

const resolveResolvedPendingInputSession = (
  context: Pick<SessionLifecycleEventContext, "store">,
  event: PendingInputResolvedEvent,
): AgentSessionState | null => {
  const targetSessionId =
    normalizeSessionId(event.childExternalSessionId) ?? normalizeSessionId(event.externalSessionId);
  return targetSessionId ? resolveLoadedSessionInEventRuntime(context, targetSessionId) : null;
};

const autoRejectMutatingApproval = (
  context: SessionLifecycleEventContext,
  event: ApprovalRequiredEvent,
  role: AgentRole,
  {
    pendingSession,
    replySession,
  }: {
    pendingSession: AgentSessionIdentity | null;
    replySession: AgentSessionIdentity;
  },
): void => {
  const pendingApproval = toPendingApproval(event);
  const markManualResponseRequired = (error: unknown): void => {
    const manualResponseSession =
      pendingSession && context.store.hasSession(pendingSession) ? pendingSession : replySession;
    context.store.updateSession(
      manualResponseSession,
      (current) => ({
        ...current,
        pendingApprovals: upsertPendingInput(current.pendingApprovals, pendingApproval),
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

  const loadedReplySession = context.store.readSession(replySession);
  if (!loadedReplySession) {
    markManualResponseRequired(
      new Error(`Session '${replySession.externalSessionId}' is not loaded.`),
    );
    return;
  }

  let replyTarget: ReturnType<typeof toRuntimeSessionContextRef>;
  try {
    replyTarget = toRuntimeSessionContextRef(context.approvals.repoPath, loadedReplySession);
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
          pendingApprovals: removePendingInput(current.pendingApprovals, event.requestId),
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

  if (role && shouldAutoRejectApproval(context, role, event)) {
    recordSessionPendingApproval(context, route.pendingSession, event);
    if (!route.approvalReplySession) {
      return;
    }
    autoRejectMutatingApproval(context, event, role, {
      pendingSession: route.pendingSession,
      replySession: route.approvalReplySession,
    });
    return;
  }

  recordSessionPendingApproval(context, route.pendingSession, event);
};

export const handlePermissionResolved = (
  context: SessionLifecycleEventContext,
  event: ApprovalResolvedEvent,
): void => {
  const targetSession = resolveResolvedPendingInputSession(context, event);
  if (!targetSession) {
    return;
  }

  context.store.updateSession(
    targetSession,
    (current) => ({
      ...current,
      pendingApprovals: removePendingInput(current.pendingApprovals, event.requestId),
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

  recordSessionPendingQuestion(context, route.pendingSession, event);
};

export const handleQuestionResolved = (
  context: SessionLifecycleEventContext,
  event: QuestionResolvedEvent,
): void => {
  const targetSession = resolveResolvedPendingInputSession(context, event);
  if (!targetSession) {
    return;
  }

  context.store.updateSession(
    targetSession,
    (current) => ({
      ...current,
      pendingQuestions: removePendingInput(current.pendingQuestions, event.requestId),
    }),
    { persist: false },
  );
};
