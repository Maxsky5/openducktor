import type { AgentRole } from "@openducktor/core";
import { isReadOnlyAgentRole } from "@openducktor/core";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { errorMessage } from "@/lib/errors";
import type {
  AgentApprovalRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import type { PendingInputRecordTarget } from "../pending-input-projection";
import { appendSessionMessage } from "../support/messages";
import { resolveRuntimeSessionContextRef } from "../support/session-runtime-policy";
import { readSessionInEventRuntime } from "./session-event-sessions";
import type { SessionEvent, SessionLifecycleEventContext } from "./session-event-types";
import {
  resolvePendingInputRoute,
  resolveResolvedPendingInputSessions,
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

const shouldStoreResponseSession = (target: PendingInputRecordTarget): boolean =>
  agentSessionIdentityKey(target.session) !== agentSessionIdentityKey(target.replySession);

const pendingInputRouting = (target: PendingInputRecordTarget) => ({
  ...(target.source ? { source: target.source } : {}),
  ...(shouldStoreResponseSession(target) ? { responseSession: target.replySession } : {}),
});

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
  target: PendingInputRecordTarget,
  event: ApprovalRequiredEvent,
): boolean => {
  const nextApproval = {
    ...toPendingApproval(event),
    ...pendingInputRouting(target),
  };
  let didCreateRequest = false;
  context.store.updateSession(target.session, (current) => {
    didCreateRequest = current.pendingApprovals.every(
      (approval) => approval.requestId !== event.requestId,
    );
    return {
      ...current,
      pendingApprovals: upsertPendingInput(current.pendingApprovals, nextApproval),
    };
  });
  return didCreateRequest;
};

const recordSessionPendingQuestion = (
  context: SessionLifecycleEventContext,
  target: PendingInputRecordTarget,
  event: QuestionRequiredEvent,
): void => {
  const nextQuestion = {
    ...toPendingQuestion(event),
    ...pendingInputRouting(target),
  };
  context.store.updateSession(target.session, (current) => ({
    ...current,
    pendingQuestions: upsertPendingInput(current.pendingQuestions, nextQuestion),
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
  return context.approvals.readOnlyApprovalAutoRejectSafe;
};

const formatAutoRejectedApprovalNotice = (
  event: ApprovalRequiredEvent,
  role: AgentRole,
): string => {
  const lines = [`Auto-rejected mutating approval for ${role} session.`, "", event.title];
  if (event.summary) {
    lines.push(event.summary);
  }
  if (event.command?.command) {
    lines.push(`Command: ${event.command.command}`);
  }
  if (event.action?.name) {
    lines.push(`Action: ${event.action.name}`);
  }
  if (event.tool?.name) {
    lines.push(`Tool: ${event.tool.name}`);
  }
  if (event.affectedPaths?.length) {
    lines.push(`Affected paths: ${event.affectedPaths.join(", ")}`);
  }
  if (event.details) {
    lines.push("", "Details:", event.details);
  }
  return lines.join("\n");
};

const readLoadedPendingInputTarget = (
  context: SessionLifecycleEventContext,
  target: PendingInputRecordTarget,
): { target: PendingInputRecordTarget; session: AgentSessionState } | null => {
  const session = context.store.readSession(target.session);
  return session ? { target, session } : null;
};

const findFirstLoadedPendingInputTarget = (
  context: SessionLifecycleEventContext,
  targets: readonly PendingInputRecordTarget[],
): { target: PendingInputRecordTarget; session: AgentSessionState } | null => {
  for (const target of targets) {
    const loadedTarget = readLoadedPendingInputTarget(context, target);
    if (loadedTarget) {
      return loadedTarget;
    }
  }
  return null;
};

const autoRejectMutatingApproval = (
  context: SessionLifecycleEventContext,
  event: ApprovalRequiredEvent,
  role: AgentRole,
  {
    pendingTarget,
    recordedTargets,
    replySession,
  }: {
    pendingTarget: PendingInputRecordTarget;
    recordedTargets: readonly PendingInputRecordTarget[];
    replySession: AgentSessionIdentity;
  },
): void => {
  const shouldPersistSession = (session: AgentSessionIdentity): boolean => {
    const loadedSession = context.store.readSession(session);
    return loadedSession !== null && loadedSession.role !== null;
  };
  const persistOptionsForSession = (session: AgentSessionIdentity) =>
    shouldPersistSession(session) ? ({ persist: true } as const) : undefined;
  const markManualResponseRequired = (error: unknown): void => {
    const workflowTarget = recordedTargets.find((target) => shouldPersistSession(target.session));
    const loadedPendingTarget = readLoadedPendingInputTarget(context, pendingTarget);
    const manualTarget = workflowTarget ?? loadedPendingTarget?.target ?? null;
    const manualResponseSession = manualTarget?.session ?? replySession;
    const pendingApproval = {
      ...toPendingApproval(event),
      ...pendingInputRouting(manualTarget ?? pendingTarget),
    };
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
      persistOptionsForSession(manualResponseSession),
    );
    patchParentSubagentSessionLink(context, event);
  };

  const loadedReplySession =
    context.store.readSession(replySession) ??
    readLoadedPendingInputTarget(context, pendingTarget)?.session ??
    findFirstLoadedPendingInputTarget(context, recordedTargets)?.session ??
    null;
  if (!loadedReplySession) {
    markManualResponseRequired(
      new Error(`Session '${replySession.externalSessionId}' is not loaded.`),
    );
    return;
  }
  if (!context.approvals.loadSettingsSnapshot) {
    markManualResponseRequired(
      new Error(
        `Cannot auto-reject approval '${event.requestId}' without runtime policy settings.`,
      ),
    );
    return;
  }
  void resolveRuntimeSessionContextRef(
    context.session.repoPath,
    {
      ...loadedReplySession,
      externalSessionId: replySession.externalSessionId,
      runtimeKind: replySession.runtimeKind,
      workingDirectory: replySession.workingDirectory,
    },
    context.approvals.loadSettingsSnapshot,
  )
    .then(async (replyTarget) => {
      const rejectionMessage = await context.approvals.buildReadOnlyApprovalRejectionMessage(role);
      await context.approvals.adapter.replyApproval({
        ...replyTarget,
        requestId: event.requestId,
        outcome: "reject",
        message: rejectionMessage,
      });
    })
    .then(() => {
      for (const target of recordedTargets) {
        context.store.updateSession(
          target.session,
          (current) => ({
            ...current,
            pendingApprovals: removePendingInput(current.pendingApprovals, event.requestId),
            messages: appendSessionMessage(current, {
              id: crypto.randomUUID(),
              role: "system",
              content: formatAutoRejectedApprovalNotice(event, role),
              timestamp: event.timestamp,
            }),
          }),
          persistOptionsForSession(target.session),
        );
      }
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
    const [primaryTarget] = route.targets;
    if (!primaryTarget) {
      return;
    }
    let didCreateRequest = false;
    for (const target of route.targets) {
      const targetWasCreated = recordSessionPendingApproval(context, target, event);
      didCreateRequest = didCreateRequest || targetWasCreated;
    }
    if (!didCreateRequest) {
      return;
    }
    autoRejectMutatingApproval(context, event, role, {
      pendingTarget: primaryTarget,
      recordedTargets: route.targets,
      replySession: primaryTarget.replySession,
    });
    return;
  }

  for (const target of route.targets) {
    recordSessionPendingApproval(context, target, event);
  }
};

export const handlePermissionResolved = (
  context: SessionLifecycleEventContext,
  event: ApprovalResolvedEvent,
): void => {
  const targetSessions = resolveResolvedPendingInputSessions(context, event);
  for (const targetSession of targetSessions) {
    context.store.updateSession(targetSession, (current) => ({
      ...current,
      pendingApprovals: removePendingInput(current.pendingApprovals, event.requestId),
    }));
  }
};

export const handleQuestionRequired = (
  context: SessionLifecycleEventContext,
  event: QuestionRequiredEvent,
): void => {
  const route = resolvePendingInputRoute(context, event);

  if (route.shouldPatchParentLink) {
    patchParentSubagentSessionLink(context, event);
  }

  for (const target of route.targets) {
    recordSessionPendingQuestion(context, target, event);
  }
};

export const handleQuestionResolved = (
  context: SessionLifecycleEventContext,
  event: QuestionResolvedEvent,
): void => {
  const targetSessions = resolveResolvedPendingInputSessions(context, event);
  for (const targetSession of targetSessions) {
    context.store.updateSession(targetSession, (current) => ({
      ...current,
      pendingQuestions: removePendingInput(current.pendingQuestions, event.requestId),
    }));
  }
};
