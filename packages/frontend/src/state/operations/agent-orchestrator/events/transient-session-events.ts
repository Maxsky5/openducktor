import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import type { AgentSessionRuntimeRef } from "@openducktor/core";
import { matchesAgentSessionIdentity, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type {
  AgentApprovalRequest,
  AgentSessionIdentity,
  AgentSessionState,
} from "@/types/agent-orchestrator";
import { createSessionTurnState } from "../support/session-turn-state";
import type { SessionEventAdapter } from "./session-event-types";
import { listenToAgentSessionEvents } from "./session-events";

export type ApplyTransientSessionEvent = (
  updater: (current: AgentSessionState) => AgentSessionState,
) => AgentSessionState;

export type ObserveTransientAgentSessionEventsParams = {
  sessionRef: AgentSessionRuntimeRef;
  subscribeEvents: SessionEventAdapter["subscribeEvents"];
  replyApproval: (
    session: AgentSessionIdentity,
    request: AgentApprovalRequest,
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
      replyApproval: ({ requestId, outcome, message, ...session }) => {
        const pendingApproval = readSession()?.pendingApprovals.find(
          (approval) => approval.requestId === requestId,
        );
        if (!pendingApproval) {
          throw new Error(`Approval request '${requestId}' is not loaded.`);
        }
        return replyApproval(toAgentSessionIdentity(session), pendingApproval, outcome, message);
      },
    },
    sessionRef,
    turnMetadata: turnState.metadata,
    readSession: (identity) =>
      matchesAgentSessionIdentity(identity, sessionRef) ? readSession() : null,
    ensureSession: (identity, createSession) => {
      if (!matchesAgentSessionIdentity(identity, sessionRef)) {
        return createSession();
      }
      return readSession() ?? applySessionEvent(() => createSession());
    },
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
