import type { AgentRole } from "@openducktor/core";
import { isReadOnlyAgentRole } from "@openducktor/core";
import { errorMessage } from "@/lib/errors";
import { getAgentSessionByExternalSessionId } from "@/state/agent-session-collection";
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
type PendingInputRequiredEvent = ApprovalRequiredEvent | QuestionRequiredEvent;
type PendingInputRoute =
  | {
      kind: "active_child_listener";
      shouldPatchParentLink: boolean;
    }
  | {
      kind: "session";
      shouldPatchParentLink: boolean;
      targetSessionId: string;
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
    getAgentSessionByExternalSessionId(
      context.store.sessionsRef.current,
      context.store.externalSessionId,
    )?.role ?? undefined
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

  const session = getAgentSessionByExternalSessionId(
    context.store.sessionsRef.current,
    context.store.externalSessionId,
  );
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
      targetSessionId: context.store.externalSessionId,
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
    targetSessionId: childExternalSessionId ?? context.store.externalSessionId,
  };
};

const autoRejectMutatingApproval = (
  context: SessionLifecycleEventContext,
  event: ApprovalRequiredEvent,
  role: AgentRole,
  {
    pendingSessionId,
    replySessionId = context.store.externalSessionId,
  }: {
    pendingSessionId: string;
    replySessionId?: string;
  },
): void => {
  const pendingApproval = toPendingApproval(event);
  const markManualResponseRequired = (error: unknown): void => {
    const manualResponseSessionId =
      getAgentSessionByExternalSessionId(context.store.sessionsRef.current, pendingSessionId) !==
      null
        ? pendingSessionId
        : replySessionId;
    context.store.updateSession(
      manualResponseSessionId,
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

  const replySession = getAgentSessionByExternalSessionId(
    context.store.sessionsRef.current,
    replySessionId,
  );
  if (!replySession) {
    markManualResponseRequired(new Error(`Session '${replySessionId}' is not loaded.`));
    return;
  }

  let replyTarget: ReturnType<typeof toRuntimeSessionContextRef>;
  try {
    replyTarget = toRuntimeSessionContextRef(context.runtimeData.sessionRef.repoPath, replySession);
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
      context.store.updateSession(
        pendingSessionId,
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
    recordSessionPendingApproval(context, route.targetSessionId, event);
    autoRejectMutatingApproval(context, event, role, {
      pendingSessionId: route.targetSessionId,
    });
    return;
  }

  recordSessionPendingApproval(context, route.targetSessionId, event);
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
  const route = resolvePendingInputRoute(context, event);

  if (route.shouldPatchParentLink) {
    patchParentSubagentSessionLink(context, event);
  }
  if (route.kind === "active_child_listener") {
    return;
  }

  recordSessionPendingQuestion(context, route.targetSessionId, event);
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
