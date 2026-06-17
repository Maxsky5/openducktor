import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { normalizeSessionId, readSessionInEventRuntime } from "./session-event-sessions";
import type { SessionEvent, SessionLifecycleEventContext } from "./session-event-types";

type ApprovalRequiredEvent = Extract<SessionEvent, { type: "approval_required" }>;
type ApprovalResolvedEvent = Extract<SessionEvent, { type: "approval_resolved" }>;
type QuestionRequiredEvent = Extract<SessionEvent, { type: "question_required" }>;
type QuestionResolvedEvent = Extract<SessionEvent, { type: "question_resolved" }>;
type PendingInputRequiredEvent = ApprovalRequiredEvent | QuestionRequiredEvent;
type PendingInputResolvedEvent = ApprovalResolvedEvent | QuestionResolvedEvent;

export type PendingInputRoute = {
  shouldPatchParentLink: boolean;
  pendingSession: AgentSessionIdentity | null;
  approvalReplySession: AgentSessionIdentity | null;
};

const isLinkedChildEventForObservedSession = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: PendingInputRequiredEvent,
  childExternalSessionId: string | null,
): boolean =>
  Boolean(
    childExternalSessionId &&
      event.parentExternalSessionId === context.session.identity.externalSessionId &&
      childExternalSessionId !== context.session.identity.externalSessionId,
  );

const isObservedSession = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  session: AgentSessionIdentity | null,
): boolean => Boolean(session && context.store.isSessionObserved(session));

export const resolvePendingInputRoute = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: PendingInputRequiredEvent,
): PendingInputRoute => {
  const childExternalSessionId = normalizeSessionId(event.childExternalSessionId);
  const shouldPatchParentLink = Boolean(event.parentExternalSessionId && childExternalSessionId);

  if (!isLinkedChildEventForObservedSession(context, event, childExternalSessionId)) {
    return {
      shouldPatchParentLink,
      pendingSession: context.session.identity,
      approvalReplySession: context.session.identity,
    };
  }

  const childSession = childExternalSessionId
    ? readSessionInEventRuntime(context, childExternalSessionId)
    : null;

  if (isObservedSession(context, childSession)) {
    return {
      shouldPatchParentLink,
      pendingSession: null,
      approvalReplySession: null,
    };
  }

  return {
    shouldPatchParentLink,
    pendingSession: childSession,
    approvalReplySession: context.session.identity,
  };
};

export const resolveResolvedPendingInputSession = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: PendingInputResolvedEvent,
): AgentSessionState | null => {
  const targetSessionId =
    normalizeSessionId(event.childExternalSessionId) ?? normalizeSessionId(event.externalSessionId);
  return targetSessionId ? readSessionInEventRuntime(context, targetSessionId) : null;
};
