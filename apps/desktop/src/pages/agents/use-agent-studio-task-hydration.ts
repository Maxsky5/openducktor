import { useEffect, useState } from "react";
import {
  getAgentSessionHistoryHydrationState,
  shouldAutoHydrateAgentSessionHistory,
} from "@/state/operations/agent-orchestrator/support/history-hydration";
import type { AgentSessionState } from "@/types/agent-orchestrator";

type UseAgentStudioTaskHydrationParams = {
  activeRepo: string | null;
  activeTaskId: string;
  activeSession: AgentSessionState | null;
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
};

export function useAgentStudioTaskHydration({
  activeRepo,
  activeTaskId,
  activeSession,
  hydrateRequestedTaskSessionHistory,
}: UseAgentStudioTaskHydrationParams): UseAgentStudioTaskHydrationResult {
  const activeSessionId = activeSession?.sessionId ?? null;
  const [requestState, setRequestState] = useState<{
    sessionId: string | null;
    status: "idle" | "pending" | "failed";
  }>({ sessionId: null, status: "idle" });
  const historyHydrationState = getAgentSessionHistoryHydrationState(activeSession);
  const shouldHydrateSessionHistory =
    Boolean(activeRepo && activeTaskId && activeSessionId) &&
    shouldAutoHydrateAgentSessionHistory(activeSession);

  useEffect(() => {
    if (!activeSessionId) {
      setRequestState({ sessionId: null, status: "idle" });
      return;
    }

    if (!shouldHydrateSessionHistory) {
      setRequestState((current) =>
        current.sessionId === activeSessionId && current.status !== "idle"
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
  }, [
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
      ? historyHydrationState === "failed" || isRequestFailed
      : false,
    isActiveSessionHistoryHydrating: activeSessionId
      ? shouldShowPendingHydrationState || historyHydrationState === "hydrating" || isRequestPending
      : false,
  };
}
