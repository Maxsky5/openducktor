import { useEffect, useReducer } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import {
  type AgentStudioReadinessState,
  deriveAgentStudioTaskHydrationState,
} from "./agent-studio-task-hydration-state";

type UseAgentStudioTaskHydrationParams = {
  activeWorkspace: ActiveWorkspace | null;
  activeTaskId: string;
  activeSession: AgentSessionState | null;
  agentStudioReadinessState: AgentStudioReadinessState;
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: AgentStudioReadinessState;
  }) => Promise<boolean>;
};

type UseAgentStudioTaskHydrationResult = {
  isActiveTaskHydrated: boolean;
  isActiveTaskHydrationFailed: boolean;
  isActiveSessionHistoryHydrated: boolean;
  isActiveSessionHistoryHydrationFailed: boolean;
  isActiveSessionHistoryHydrating: boolean;
  isWaitingForRuntimeReadiness: boolean;
};

type RequestState = {
  externalSessionId: string | null;
  status: "idle" | "pending" | "failed";
};

type RequestAction =
  | { type: "reset" }
  | { type: "pending"; externalSessionId: string }
  | { type: "idleIfCurrent"; externalSessionId: string }
  | { type: "failedIfCurrent"; externalSessionId: string };

const requestStateReducer = (state: RequestState, action: RequestAction): RequestState => {
  switch (action.type) {
    case "reset":
      return { externalSessionId: null, status: "idle" };
    case "pending":
      return { externalSessionId: action.externalSessionId, status: "pending" };
    case "idleIfCurrent":
      return state.externalSessionId === action.externalSessionId
        ? { externalSessionId: action.externalSessionId, status: "idle" }
        : state;
    case "failedIfCurrent":
      return state.externalSessionId === action.externalSessionId
        ? { externalSessionId: action.externalSessionId, status: "failed" }
        : state;
  }
};

export function useAgentStudioTaskHydration({
  activeWorkspace,
  activeTaskId,
  activeSession,
  agentStudioReadinessState,
  ensureSessionReadyForView,
}: UseAgentStudioTaskHydrationParams): UseAgentStudioTaskHydrationResult {
  const activeExternalSessionId = activeSession?.externalSessionId ?? null;
  const [requestState, dispatchRequestState] = useReducer(requestStateReducer, {
    externalSessionId: null,
    status: "idle",
  });
  const lifecycle = deriveAgentStudioTaskHydrationState({
    activeSession,
    agentStudioReadinessState,
  });

  const isRequestFailed =
    requestState.externalSessionId === activeExternalSessionId && requestState.status === "failed";
  const shouldEnsureSessionReady = lifecycle.shouldEnsureReadyForView && !isRequestFailed;

  useEffect(() => {
    if (!activeExternalSessionId) {
      dispatchRequestState({ type: "reset" });
      return;
    }

    if (!shouldEnsureSessionReady) {
      dispatchRequestState({ type: "idleIfCurrent", externalSessionId: activeExternalSessionId });
      return;
    }

    dispatchRequestState({ type: "pending", externalSessionId: activeExternalSessionId });
    void ensureSessionReadyForView({
      taskId: activeTaskId,
      externalSessionId: activeExternalSessionId,
      repoReadinessState: agentStudioReadinessState,
    })
      .then(() => {
        dispatchRequestState({ type: "idleIfCurrent", externalSessionId: activeExternalSessionId });
      })
      .catch(() => {
        dispatchRequestState({
          type: "failedIfCurrent",
          externalSessionId: activeExternalSessionId,
        });
      });
  }, [
    activeExternalSessionId,
    activeTaskId,
    agentStudioReadinessState,
    ensureSessionReadyForView,
    shouldEnsureSessionReady,
  ]);

  const shouldShowPendingHydrationState =
    requestState.externalSessionId === activeExternalSessionId && requestState.status === "pending";

  return {
    isActiveTaskHydrated: Boolean(activeWorkspace && activeTaskId),
    isActiveTaskHydrationFailed: false,
    isActiveSessionHistoryHydrated: activeExternalSessionId ? lifecycle.canRenderHistory : false,
    isActiveSessionHistoryHydrationFailed: activeExternalSessionId
      ? lifecycle.isHistoryHydrationFailed || isRequestFailed
      : false,
    isActiveSessionHistoryHydrating: activeExternalSessionId
      ? shouldShowPendingHydrationState || lifecycle.isHydratingHistory
      : false,
    isWaitingForRuntimeReadiness: activeExternalSessionId
      ? lifecycle.isWaitingForRuntimeReadiness && !isRequestFailed
      : false,
  };
}
