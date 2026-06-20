import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { AgentSessionRef } from "@openducktor/core";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionTurnState } from "../support/session-turn-state";
import type { SessionEventAdapter } from "./session-event-types";
import { listenToAgentSessionEvents } from "./session-events";

export type ApplyTransientSessionEvent = (
  updater: (current: AgentSessionState) => AgentSessionState,
) => AgentSessionState;

export type ObserveTransientAgentSessionEventsParams = {
  sessionRef: AgentSessionRef;
  subscribeEvents: SessionEventAdapter["subscribeEvents"];
  replyApproval: (
    session: AgentSessionIdentity,
    requestId: string,
    outcome: RuntimeApprovalReplyOutcome,
    message?: string,
  ) => Promise<void>;
  readSession: () => AgentSessionState | null;
  applySessionEvent: ApplyTransientSessionEvent;
};

export const observeTransientAgentSessionEvents = async ({
  sessionRef,
  subscribeEvents,
  replyApproval,
  readSession,
  applySessionEvent,
}: ObserveTransientAgentSessionEventsParams): Promise<() => void> => {
  const turnState = createSessionTurnState();
  const unsubscribe = await listenToAgentSessionEvents({
    adapter: {
      subscribeEvents,
      replyApproval: ({ requestId, outcome, message, ...session }) =>
        replyApproval(session, requestId, outcome, message),
    },
    sessionRef,
    turnMetadata: turnState.metadata,
    readSession: (identity) =>
      matchesAgentSessionIdentity(identity, sessionRef) ? readSession() : null,
    updateSession: (identity, updater) => {
      if (!matchesAgentSessionIdentity(identity, sessionRef)) {
        return null;
      }
      return applySessionEvent(updater);
    },
    updateSessionTodos: () => undefined,
    isSessionObserved: (identity) => matchesAgentSessionIdentity(identity, sessionRef),
    recordTurnActivityTimestamp: turnState.timing.recordTurnActivityTimestamp,
    recordTurnUserMessageTimestamp: turnState.timing.recordTurnUserMessageTimestamp,
    resolveTurnDurationMs: turnState.timing.resolveTurnDurationMs,
    clearTurnDuration: turnState.timing.clearTurnDuration,
    buildReadOnlyApprovalRejectionMessage: async () => {
      throw new Error("Transient transcript observers do not auto-reject approvals.");
    },
    readOnlyApprovalAutoRejectSafe: false,
    refreshTaskData: async () => undefined,
    workflowToolAliasesByCanonical: undefined,
  });

  return () => {
    unsubscribe();
    turnState.clearAll();
  };
};
