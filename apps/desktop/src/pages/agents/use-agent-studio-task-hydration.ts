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
import { useAgentStudioSessionRuntimeRecovery } from "./use-agent-studio-session-runtime-recovery";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSession: AgentSessionState | null;
  agentStudioReadinessState: AgentStudioReadinessState;
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    sessionId: string;
  }) => Promise<void>;
  recoverSessionRuntimeAttachment: (input: {
    taskId: string;
    sessionId: string;
    recoveryDedupKey?: string | null;
  }) => Promise<boolean>;
  refreshSessionRuntimeRecoverySources: () => Promise<void>;
  sessionRuntimeRecoverySignal: string;
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
  recoverSessionRuntimeAttachment,
  refreshSessionRuntimeRecoverySources,
  sessionRuntimeRecoverySignal,
}: UseAgentStudioTaskHydrationParams): UseAgentStudioTaskHydrationResult {
  const activeSessionId = activeSession?.sessionId ?? null;
  const [requestState, setRequestState] = useState<{
    sessionId: string | null;
    status: "idle" | "pending" | "failed";
  }>({ sessionId: null, status: "idle" });
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
  });

  useAgentStudioSessionRuntimeRecovery({
    activeTaskId,
    activeSessionId,
    shouldWaitForSessionRuntime,
    activeRecoveryKey,
    sessionRuntimeRecoverySignal,
    recoverSessionRuntimeAttachment,
    refreshSessionRuntimeRecoverySources,
  });

  const isRequestFailed =
    requestState.sessionId === activeSessionId && requestState.status === "failed";
  const shouldRequestHydration = shouldHydrateSessionHistory && !isRequestFailed;

  useEffect(() => {
    if (!activeSessionId) {
      setRequestState({ sessionId: null, status: "idle" });
      return;
    }

    if (!shouldRequestHydration) {
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
      })
      .catch(() => {
        setRequestState((current) =>
          current.sessionId === activeSessionId
            ? { sessionId: activeSessionId, status: "failed" }
            : current,
        );
      });
  }, [activeSessionId, activeTaskId, hydrateRequestedTaskSessionHistory, shouldRequestHydration]);

  const isRequestPending =
    requestState.sessionId === activeSessionId && requestState.status === "pending";
  const shouldShowPendingHydrationState = shouldRequestHydration;

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
    isWaitingForRuntimeReadiness: activeSessionId
      ? isWaitingForRuntimeReadiness && !isRequestFailed
      : false,
  };
}
