import type { AgentRole } from "@openducktor/core";
import { isReadOnlyAgentRole } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import type { AgentApprovalRequest, AgentSessionIdentity } from "@/types/agent-orchestrator";
import { appendSessionMessage } from "../support/messages";
import { toRuntimeSessionContextRef } from "../support/session-runtime-ref";
import { readSessionInEventRuntime } from "./session-event-sessions";
import type { SessionEvent, SessionLifecycleEventContext } from "./session-event-types";
import {
  resolvePendingInputRoute,
  resolveResolvedPendingInputSession,
} from "./session-pending-input-routing";
import { patchParentSubagentSessionLink } from "./session-subagent-links";

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

const upsertPendingInput = <Entry extends { requestId: string }>(
  entries: Entry[],
  nextEntry: Entry,
): Entry[] => [...entries.filter((entry) => entry.requestId !== nextEntry.requestId), nextEntry];

const removePendingInput = <Entry extends { requestId: string }>(
  entries: Entry[],
  requestId: string,
): Entry[] => entries.filter((entry) => entry.requestId !== requestId);

const resolvePermissionPolicyRole = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: ApprovalRequiredEvent,
): AgentRole | undefined => {
  if (event.parentExternalSessionId) {
    const parentRole = readSessionInEventRuntime(context, event.parentExternalSessionId)?.role;
    if (parentRole) {
      return parentRole;
    }
  }

  return context.store.readSession(context.session.identity)?.role ?? undefined;
};

const recordSessionPendingApproval = (
  context: SessionLifecycleEventContext,
  targetSession: AgentSessionIdentity | null,
  event: ApprovalRequiredEvent,
): void => {
  if (!targetSession) {
    return;
  }
  context.store.updateSession(targetSession, (current) => ({
    ...current,
    pendingApprovals: upsertPendingInput(current.pendingApprovals, toPendingApproval(event)),
  }));
};

const recordSessionPendingQuestion = (
  context: SessionLifecycleEventContext,
  targetSession: AgentSessionIdentity | null,
  event: QuestionRequiredEvent,
): void => {
  if (!targetSession) {
    return;
  }
  context.store.updateSession(targetSession, (current) => ({
    ...current,
    pendingQuestions: upsertPendingInput(current.pendingQuestions, toPendingQuestion(event)),
  }));
};

const shouldAutoRejectApproval = (
  context: SessionLifecycleEventContext,
  role: AgentRole | undefined,
  event: ApprovalRequiredEvent,
): boolean => {
  if (role === undefined || !isReadOnlyAgentRole(role) || event.mutation !== "mutating") {
    return false;
  }

  const session = context.store.readSession(context.session.identity);
  if (!session) {
    return false;
  }
  return context.approvals.canAutoRejectReadOnlyApproval(session.runtimeKind);
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
      pendingSession && context.store.readSession(pendingSession) ? pendingSession : replySession;
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

  context.store.updateSession(targetSession, (current) => ({
    ...current,
    pendingApprovals: removePendingInput(current.pendingApprovals, event.requestId),
  }));
};

export const handleQuestionRequired = (
  context: SessionLifecycleEventContext,
  event: QuestionRequiredEvent,
): void => {
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

  context.store.updateSession(targetSession, (current) => ({
    ...current,
    pendingQuestions: removePendingInput(current.pendingQuestions, event.requestId),
  }));
};
