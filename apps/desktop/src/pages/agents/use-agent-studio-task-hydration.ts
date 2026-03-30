import { useEffect, useState } from "react";
import {
  getAgentSessionHistoryHydrationState,
  requiresHydratedAgentSessionHistory,
} from "@/state/operations/agent-orchestrator/support/history-hydration";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSession: AgentSessionState | null;
  agentStudioReadinessState: "ready" | "checking" | "blocked";
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    sessionId: string;
  }) => Promise<void>;
};

type UseAgentStudioTaskHydrationResult = {
  isActiveTaskHydrated: boolean;
  isActiveTaskHydrationFailed: boolean;
  isActiveSessionHistoryHydrated: boolean;
  isActiveSessionHistoryHydrationFailed: boolean;
  isActiveSessionHistoryHydrating: boolean;
  isWaitingForRuntimeReadiness: boolean;
};

export function useAgentStudioTaskHydration({
  activeRepo,
  activeTaskId,
  activeSession,
  agentStudioReadinessState,
  hydrateRequestedTaskSessionHistory,
}: UseAgentStudioTaskHydrationParams): UseAgentStudioTaskHydrationResult {
  const activeSessionId = activeSession?.sessionId ?? null;
  const [requestState, setRequestState] = useState<{
    sessionId: string | null;
    status: "idle" | "pending" | "failed";
  }>({ sessionId: null, status: "idle" });
  const [waitingSessionId, setWaitingSessionId] = useState<string | null>(null);
  const [postReadyFailureSessionId, setPostReadyFailureSessionId] = useState<string | null>(null);
  const historyHydrationState = getAgentSessionHistoryHydrationState(activeSession);
  const sessionNeedsHydration = requiresHydratedAgentSessionHistory(activeSession);
  const isReadinessReady = agentStudioReadinessState === "ready";
  const blockedFromAutomaticRecovery =
    Boolean(activeSessionId) && postReadyFailureSessionId === activeSessionId;
  const isWaitingForReadiness =
    Boolean(activeRepo && activeTaskId && activeSessionId) &&
    !isReadinessReady &&
    sessionNeedsHydration &&
    !blockedFromAutomaticRecovery;
  const isRecoveringWaitingSession =
    Boolean(activeSessionId && activeRepo && activeTaskId) &&
    isReadinessReady &&
    waitingSessionId === activeSessionId &&
    sessionNeedsHydration;
  const shouldHydrateSessionHistory =
    Boolean(activeRepo && activeTaskId && activeSessionId) &&
    isReadinessReady &&
    sessionNeedsHydration &&
    !blockedFromAutomaticRecovery &&
    (historyHydrationState === "not_requested" || waitingSessionId === activeSessionId);

  useEffect(() => {
    if (!activeSessionId || !sessionNeedsHydration) {
      setWaitingSessionId((current) => (current === null ? current : null));
      setPostReadyFailureSessionId((current) => (current === null ? current : null));
      return;
    }

    if (historyHydrationState === "hydrated") {
      setPostReadyFailureSessionId((current) => (current === activeSessionId ? null : current));
    }

    if (!isReadinessReady) {
      setWaitingSessionId((current) => {
        if (blockedFromAutomaticRecovery) {
          return current === activeSessionId ? null : current;
        }

        if (historyHydrationState !== "failed") {
          return current;
        }

        return current ?? activeSessionId;
      });
      return;
    }

    if (waitingSessionId === activeSessionId && historyHydrationState === "hydrated") {
      setWaitingSessionId(null);
    }
  }, [
    activeSessionId,
    blockedFromAutomaticRecovery,
    historyHydrationState,
    isReadinessReady,
    sessionNeedsHydration,
    waitingSessionId,
  ]);

  useEffect(() => {
    if (!activeSessionId) {
      setRequestState({ sessionId: null, status: "idle" });
      return;
    }

    if (!shouldHydrateSessionHistory) {
      setRequestState((current) =>
        current.sessionId === activeSessionId && current.status === "pending"
          ? { sessionId: activeSessionId, status: "idle" }
          : current,
      );
      return;
    }

    setRequestState({ sessionId: activeSessionId, status: "pending" });
    void hydrateRequestedTaskSessionHistory({
      taskId: activeTaskId,
      sessionId: activeSessionId,
    })
      .then(() => {
        setRequestState((current) =>
          current.sessionId === activeSessionId
            ? { sessionId: activeSessionId, status: "idle" }
            : current,
        );
        setWaitingSessionId((current) => (current === activeSessionId ? null : current));
        setPostReadyFailureSessionId((current) => (current === activeSessionId ? null : current));
      })
      .catch(() => {
        setRequestState((current) =>
          current.sessionId === activeSessionId
            ? { sessionId: activeSessionId, status: "failed" }
            : current,
        );
        if (waitingSessionId !== activeSessionId) {
          setPostReadyFailureSessionId(activeSessionId);
        }
        setWaitingSessionId((current) => (current === activeSessionId ? null : current));
      });
  }, [
    activeSessionId,
    activeTaskId,
    hydrateRequestedTaskSessionHistory,
    shouldHydrateSessionHistory,
    waitingSessionId,
  ]);

  const isRequestPending =
    requestState.sessionId === activeSessionId && requestState.status === "pending";
  const isRequestFailed =
    requestState.sessionId === activeSessionId && requestState.status === "failed";
  const shouldShowPendingHydrationState = shouldHydrateSessionHistory && !isRequestFailed;

  return {
    isActiveTaskHydrated: Boolean(activeRepo && activeTaskId),
    isActiveTaskHydrationFailed: false,
    isActiveSessionHistoryHydrated: activeSessionId ? historyHydrationState === "hydrated" : false,
    isActiveSessionHistoryHydrationFailed: activeSessionId
      ? (historyHydrationState === "failed" &&
          !isWaitingForReadiness &&
          !isRecoveringWaitingSession) ||
        isRequestFailed
      : false,
    isActiveSessionHistoryHydrating: activeSessionId
      ? shouldShowPendingHydrationState || historyHydrationState === "hydrating" || isRequestPending
      : false,
    isWaitingForRuntimeReadiness: activeSessionId ? isWaitingForReadiness : false,
  };
}
