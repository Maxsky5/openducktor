import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { useEffect, useRef, useState } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import { listenToAgentSessionEvents } from "@/state/operations/agent-orchestrator/events/session-events";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import { toRuntimeSessionRef } from "@/state/operations/agent-orchestrator/support/session-runtime-ref";
import { createSessionTurnState } from "@/state/operations/agent-orchestrator/support/session-turn-state";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@/types/state-slices";
import {
  createEmptyReadonlyRuntimeSessionState,
  mergeReadonlyRuntimeHistory,
} from "./readonly-transcript-session";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

type RuntimeTranscriptLiveState = {
  session: AgentSessionState;
  hasRuntimeEvents: boolean;
  error: string | null;
};

type RuntimeTranscriptLiveOverlay = {
  session: AgentSessionState | null;
  interactionSession: AgentSessionState | null;
  error: string | null;
  hasVisibleRuntimeData: boolean;
};

type UseRuntimeTranscriptLiveOverlayArgs = {
  shouldObserve: boolean;
  repoPath: string | null;
  target: AgentSessionIdentity | null;
  history: AgentSessionHistoryMessage[] | undefined;
  shouldMergeHistory: boolean;
  replyAgentApproval: AgentOperationsContextValue["replyAgentApproval"];
  subscribeSessionEvents: AgentOperationsContextValue["subscribeSessionEvents"];
};

const EMPTY_RUNTIME_TRANSCRIPT_LIVE_OVERLAY: RuntimeTranscriptLiveOverlay = {
  session: null,
  interactionSession: null,
  error: null,
  hasVisibleRuntimeData: false,
};

const hasVisibleRuntimeData = (session: AgentSessionState): boolean =>
  getSessionMessageCount(session) > 0 ||
  session.pendingApprovals.length > 0 ||
  session.pendingQuestions.length > 0;

export function useRuntimeTranscriptLiveOverlay({
  shouldObserve,
  repoPath,
  target,
  history,
  shouldMergeHistory,
  replyAgentApproval,
  subscribeSessionEvents,
}: UseRuntimeTranscriptLiveOverlayArgs): RuntimeTranscriptLiveOverlay {
  const [liveState, setLiveState] = useState<RuntimeTranscriptLiveState | null>(null);
  const liveStateRef = useRef<RuntimeTranscriptLiveState | null>(null);

  useEffect(() => {
    liveStateRef.current = liveState;
  }, [liveState]);

  useEffect(() => {
    if (!shouldObserve || repoPath === null || target === null) {
      liveStateRef.current = null;
      setLiveState(null);
      return;
    }

    const sessionRef = toRuntimeSessionRef(repoPath, target);
    const turnState = createSessionTurnState();
    let isCancelled = false;
    let unsubscribe: (() => void) | null = null;

    const ensureSession = (): AgentSessionState => {
      const current = liveStateRef.current?.session;
      if (current && matchesAgentSessionIdentity(current, target)) {
        return current;
      }
      return createEmptyReadonlyRuntimeSessionState(target);
    };

    const setNextState = (nextState: RuntimeTranscriptLiveState): void => {
      liveStateRef.current = nextState;
      setLiveState(nextState);
    };

    setNextState({
      session: ensureSession(),
      hasRuntimeEvents: false,
      error: null,
    });

    void listenToAgentSessionEvents({
      adapter: {
        subscribeEvents: subscribeSessionEvents,
        replyApproval: ({ requestId, outcome, message, ...session }) =>
          replyAgentApproval(session, requestId, outcome, message),
      },
      sessionRef,
      turnMetadata: turnState.metadata,
      readSession: (identity) =>
        matchesAgentSessionIdentity(identity, target)
          ? (liveStateRef.current?.session ?? null)
          : null,
      updateSession: (identity, updater) => {
        if (!matchesAgentSessionIdentity(identity, target)) {
          return null;
        }

        const nextSession = updater(ensureSession());
        setNextState({
          session: nextSession,
          hasRuntimeEvents: true,
          error: null,
        });
        return nextSession;
      },
      updateSessionTodos: () => undefined,
      isSessionObserved: (identity) => matchesAgentSessionIdentity(identity, target),
      recordTurnActivityTimestamp: turnState.timing.recordTurnActivityTimestamp,
      recordTurnUserMessageTimestamp: turnState.timing.recordTurnUserMessageTimestamp,
      resolveTurnDurationMs: turnState.timing.resolveTurnDurationMs,
      clearTurnDuration: turnState.timing.clearTurnDuration,
      buildReadOnlyApprovalRejectionMessage: async () => {
        throw new Error("Read-only transcript views do not auto-reject approvals.");
      },
      readOnlyApprovalAutoRejectSafe: false,
      refreshTaskData: async () => undefined,
      workflowToolAliasesByCanonical: undefined,
    })
      .then((nextUnsubscribe) => {
        if (isCancelled) {
          nextUnsubscribe();
          return;
        }
        unsubscribe = nextUnsubscribe;
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        setNextState({
          session: ensureSession(),
          hasRuntimeEvents: false,
          error: errorMessageFromUnknown(error, "Failed to subscribe to transcript updates."),
        });
      });

    return () => {
      isCancelled = true;
      unsubscribe?.();
      turnState.clearAll();
    };
  }, [repoPath, replyAgentApproval, shouldObserve, subscribeSessionEvents, target]);

  useEffect(() => {
    if (!shouldMergeHistory || target === null || !history) {
      return;
    }

    setLiveState((current) => {
      const currentSession =
        current?.session && matchesAgentSessionIdentity(current.session, target)
          ? current.session
          : createEmptyReadonlyRuntimeSessionState(target);
      const nextState: RuntimeTranscriptLiveState = {
        session: mergeReadonlyRuntimeHistory(currentSession, history),
        hasRuntimeEvents: current?.hasRuntimeEvents ?? false,
        error: current?.error ?? null,
      };
      liveStateRef.current = nextState;
      return nextState;
    });
  }, [history, shouldMergeHistory, target]);

  if (
    target === null ||
    !liveState?.session ||
    !matchesAgentSessionIdentity(liveState.session, target)
  ) {
    return EMPTY_RUNTIME_TRANSCRIPT_LIVE_OVERLAY;
  }

  const session = liveState.session;
  const hasRuntimeEvents = liveState.hasRuntimeEvents;
  return {
    session,
    interactionSession: hasRuntimeEvents ? session : null,
    error: liveState.error,
    hasVisibleRuntimeData: hasRuntimeEvents && hasVisibleRuntimeData(session),
  };
}
