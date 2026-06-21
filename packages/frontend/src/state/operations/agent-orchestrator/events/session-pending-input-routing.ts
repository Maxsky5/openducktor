import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type PendingInputRoute,
  projectPendingInputRoute,
  projectResolvedPendingInputSessions,
} from "../pending-input-projection";
import { readSessionInEventRuntime } from "./session-event-sessions";
import type { SessionEvent, SessionLifecycleEventContext } from "./session-event-types";

type ApprovalRequiredEvent = Extract<SessionEvent, { type: "approval_required" }>;
type ApprovalResolvedEvent = Extract<SessionEvent, { type: "approval_resolved" }>;
type QuestionRequiredEvent = Extract<SessionEvent, { type: "question_required" }>;
type QuestionResolvedEvent = Extract<SessionEvent, { type: "question_resolved" }>;
type PendingInputRequiredEvent = ApprovalRequiredEvent | QuestionRequiredEvent;
type PendingInputResolvedEvent = ApprovalResolvedEvent | QuestionResolvedEvent;

export const resolvePendingInputRoute = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: PendingInputRequiredEvent,
): PendingInputRoute =>
  projectPendingInputRoute({
    observedSession: context.session.identity,
    parentExternalSessionId: event.parentExternalSessionId,
    childExternalSessionId: event.childExternalSessionId,
    subagentCorrelationKey: event.subagentCorrelationKey,
    readSession: (externalSessionId) => readSessionInEventRuntime(context, externalSessionId),
  });

export const resolveResolvedPendingInputSessions = (
  context: Pick<SessionLifecycleEventContext, "session" | "store">,
  event: PendingInputResolvedEvent,
): AgentSessionState[] =>
  projectResolvedPendingInputSessions({
    observedSession: context.session.identity,
    parentExternalSessionId: event.parentExternalSessionId,
    externalSessionId: event.externalSessionId,
    childExternalSessionId: event.childExternalSessionId,
    readSession: (externalSessionId) => readSessionInEventRuntime(context, externalSessionId),
  });
