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
import {
  type RuntimeAttachmentCandidate,
  useAgentStudioRuntimeAttachmentRetry,
} from "./use-agent-studio-runtime-attachment-retry";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSession: AgentSessionState | null;
  agentStudioReadinessState: AgentStudioReadinessState;
  hydrateRequestedTaskSessionHistory: (input: {
    taskId: string;
    sessionId: string;
  }) => Promise<void>;
  retrySessionRuntimeAttachment: (input: {
    taskId: string;
    sessionId: string;
    recoveryDedupKey?: string | null;
  }) => Promise<boolean>;
  refreshRuntimeAttachmentSources: () => Promise<void>;
  runtimeAttachmentCandidates: RuntimeAttachmentCandidate[];
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
  retrySessionRuntimeAttachment,
  refreshRuntimeAttachmentSources,
  runtimeAttachmentCandidates,
}: UseAgentStudioTaskHydrationParams): UseAgentStudioTaskHydrationResult {
  const activeSessionId = activeSession?.sessionId ?? null;
  const [requestState, setRequestState] = useState<{
    sessionId: string | null;
    status: "idle" | "pending" | "failed";
  }>({ sessionId: null, status: "idle" });
  const historyHydrationState = getAgentSessionHistoryHydrationState(activeSession);
  const sessionNeedsHydration = requiresHydratedAgentSessionHistory(activeSession);
  const {
    activeRuntimeAttachmentKey,
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

  useAgentStudioRuntimeAttachmentRetry({
    activeTaskId,
    activeSessionId,
    shouldWaitForSessionRuntime,
    activeRuntimeAttachmentKey,
    runtimeAttachmentCandidates,
    retrySessionRuntimeAttachment,
    refreshRuntimeAttachmentSources,
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
