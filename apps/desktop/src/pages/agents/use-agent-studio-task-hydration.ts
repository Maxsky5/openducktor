import { useEffect, useState } from "react";
import {
  getAgentSessionHistoryHydrationState,
  requiresHydratedAgentSessionHistory,
} from "@/state/operations/agent-orchestrator/support/history-hydration";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import {
  type AgentStudioReadinessState,
  getAgentStudioTaskHydrationDecision,
} from "./agent-studio-task-hydration-state";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSession: AgentSessionState | null;
  agentStudioReadinessState: AgentStudioReadinessState;
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
  const [waitingRecoveryKey, setWaitingRecoveryKey] = useState<string | null>(null);
  const [postReadyFailureRecoveryKey, setPostReadyFailureRecoveryKey] = useState<string | null>(
    null,
  );
  const historyHydrationState = getAgentSessionHistoryHydrationState(activeSession);
  const sessionNeedsHydration = requiresHydratedAgentSessionHistory(activeSession);
  const {
    activeRecoveryKey,
    shouldWaitForSessionRuntime,
    isWaitingForRuntimeReadiness,
    isRecoveringWaitingSession,
    shouldHydrateSessionHistory,
  } = getAgentStudioTaskHydrationDecision({
    activeRepo,
    activeTaskId,
    activeSession,
    historyHydrationState,
    sessionNeedsHydration,
    agentStudioReadinessState,
    waitingRecoveryKey,
    postReadyFailureRecoveryKey,
  });

  useEffect(() => {
    if (!activeRepo) {
      setWaitingRecoveryKey(null);
      setPostReadyFailureRecoveryKey(null);
      return;
    }

    if (!activeRecoveryKey) {
      return;
    }

    if (!sessionNeedsHydration) {
      setWaitingRecoveryKey((current) => (current === activeRecoveryKey ? null : current));
      setPostReadyFailureRecoveryKey((current) => (current === activeRecoveryKey ? null : current));
      return;
    }

    if (isWaitingForRuntimeReadiness) {
      setWaitingRecoveryKey((current) => {
        if (historyHydrationState === "failed") {
          return activeRecoveryKey;
        }

        if (shouldWaitForSessionRuntime) {
          return current ?? activeRecoveryKey;
        }

        return current;
      });
      return;
    }

    if (waitingRecoveryKey === activeRecoveryKey && historyHydrationState === "hydrated") {
      setWaitingRecoveryKey(null);
    }
  }, [
    activeRecoveryKey,
    activeRepo,
    historyHydrationState,
    isWaitingForRuntimeReadiness,
    shouldWaitForSessionRuntime,
    sessionNeedsHydration,
    waitingRecoveryKey,
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
        setWaitingRecoveryKey((current) => (current === activeRecoveryKey ? null : current));
        setPostReadyFailureRecoveryKey((current) =>
          current === activeRecoveryKey ? null : current,
        );
      })
      .catch(() => {
        setRequestState((current) =>
          current.sessionId === activeSessionId
            ? { sessionId: activeSessionId, status: "failed" }
            : current,
        );
        if (activeRecoveryKey) {
          setPostReadyFailureRecoveryKey(activeRecoveryKey);
        }
        setWaitingRecoveryKey((current) => (current === activeRecoveryKey ? null : current));
      });
  }, [
    activeRecoveryKey,
    activeSessionId,
    activeTaskId,
    hydrateRequestedTaskSessionHistory,
    shouldHydrateSessionHistory,
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
          !isWaitingForRuntimeReadiness &&
          !isRecoveringWaitingSession) ||
        isRequestFailed
      : false,
    isActiveSessionHistoryHydrating: activeSessionId
      ? shouldShowPendingHydrationState || historyHydrationState === "hydrating" || isRequestPending
      : false,
    isWaitingForRuntimeReadiness: activeSessionId ? isWaitingForRuntimeReadiness : false,
  };
}
