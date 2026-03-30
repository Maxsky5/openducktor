import { useEffect, useState } from "react";
import {
  getAgentSessionHistoryHydrationState,
  requiresHydratedAgentSessionHistory,
} from "@/state/operations/agent-orchestrator/support/history-hydration";
import type { AgentSessionState } from "@/types/agent-orchestrator";

const WORKTREE_RUNTIME_ROLES = new Set<AgentSessionState["role"]>(["build", "qa"]);

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

const toRecoverySelectionKey = ({
  activeRepo,
  activeTaskId,
  activeSessionId,
}: {
  activeRepo: string | null;
  activeTaskId: string;
  activeSessionId: string | null;
}): string | null => {
  if (!activeRepo || !activeTaskId || !activeSessionId) {
    return null;
  }

  return `${activeRepo}::${activeTaskId}::${activeSessionId}`;
};

export function useAgentStudioTaskHydration({
  activeRepo,
  activeTaskId,
  activeSession,
  agentStudioReadinessState,
  hydrateRequestedTaskSessionHistory,
}: UseAgentStudioTaskHydrationParams): UseAgentStudioTaskHydrationResult {
  const activeSessionId = activeSession?.sessionId ?? null;
  const activeSessionRole = activeSession?.role ?? null;
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
  const isReadinessReady = agentStudioReadinessState === "ready";
  const activeRecoveryKey = toRecoverySelectionKey({
    activeRepo,
    activeTaskId,
    activeSessionId,
  });
  const blockedFromAutomaticRecovery =
    Boolean(activeRecoveryKey) && postReadyFailureRecoveryKey === activeRecoveryKey;
  const requiresLiveWorktreeRuntime =
    activeSessionRole !== null && WORKTREE_RUNTIME_ROLES.has(activeSessionRole);
  const isMissingAttachedRuntime =
    requiresLiveWorktreeRuntime &&
    activeSession !== null &&
    activeSession.runId === null &&
    activeSession.runtimeId === null &&
    activeSession.runtimeEndpoint.trim().length === 0;
  const shouldWaitForSessionRuntime =
    Boolean(activeRecoveryKey) &&
    isReadinessReady &&
    sessionNeedsHydration &&
    isMissingAttachedRuntime &&
    !blockedFromAutomaticRecovery;
  const isWaitingForReadiness =
    Boolean(activeRecoveryKey) &&
    (!isReadinessReady || shouldWaitForSessionRuntime) &&
    sessionNeedsHydration &&
    !blockedFromAutomaticRecovery;
  const isRecoveringWaitingSession =
    Boolean(activeRecoveryKey) &&
    isReadinessReady &&
    !shouldWaitForSessionRuntime &&
    waitingRecoveryKey === activeRecoveryKey &&
    sessionNeedsHydration;
  const shouldHydrateSessionHistory =
    Boolean(activeRecoveryKey) &&
    isReadinessReady &&
    !shouldWaitForSessionRuntime &&
    sessionNeedsHydration &&
    !blockedFromAutomaticRecovery &&
    (historyHydrationState === "not_requested" || waitingRecoveryKey === activeRecoveryKey);

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

    if (!isReadinessReady || shouldWaitForSessionRuntime) {
      setWaitingRecoveryKey((current) => {
        if (blockedFromAutomaticRecovery) {
          return current === activeRecoveryKey ? null : current;
        }

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
    blockedFromAutomaticRecovery,
    historyHydrationState,
    isReadinessReady,
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
