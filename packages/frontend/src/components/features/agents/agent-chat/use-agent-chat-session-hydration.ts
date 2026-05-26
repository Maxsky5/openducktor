import type { AgentSessionRecord } from "@openducktor/contracts";
import { useEffect, useReducer } from "react";
import {
  deriveAgentSessionViewLifecycle,
  type SessionRepoReadinessState,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentSessionHistoryPreludeMode, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";

type UseAgentChatSessionHydrationParams = {
  activeWorkspace: ActiveWorkspace | null;
  activeTaskId: string;
  activeSession: AgentSessionState | null;
  historyPreludeMode?: AgentSessionHistoryPreludeMode;
  persistedRecords?: AgentSessionRecord[];
  repoReadinessState: SessionRepoReadinessState;
  ensureSessionReadyForView: (input: {
    taskId: string;
    externalSessionId: string;
    repoReadinessState: SessionRepoReadinessState;
    historyPreludeMode?: AgentSessionHistoryPreludeMode;
    persistedRecords?: AgentSessionRecord[];
  }) => Promise<boolean>;
};

export type AgentChatSessionHydrationResult = {
  isActiveTaskHydrated: boolean;
  isActiveTaskHydrationFailed: boolean;
  isActiveSessionHistoryHydrated: boolean;
  isActiveSessionHistoryHydrationFailed: boolean;
  isActiveSessionHistoryHydrating: boolean;
  isWaitingForRuntimeReadiness: boolean;
};

type HydrationRequestState = {
  externalSessionId: string | null;
  status: "idle" | "pending" | "failed";
};

type HydrationRequestAction =
  | { type: "reset" }
  | { type: "pending"; externalSessionId: string }
  | { type: "idleIfCurrent"; externalSessionId: string }
  | { type: "failedIfCurrent"; externalSessionId: string };

const hydrationRequestReducer = (
  state: HydrationRequestState,
  action: HydrationRequestAction,
): HydrationRequestState => {
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

export function useAgentChatSessionHydration({
  activeWorkspace,
  activeTaskId,
  activeSession,
  historyPreludeMode,
  persistedRecords,
  repoReadinessState,
  ensureSessionReadyForView,
}: UseAgentChatSessionHydrationParams): AgentChatSessionHydrationResult {
  const activeExternalSessionId = activeSession?.externalSessionId ?? null;
  const [requestState, dispatchRequestState] = useReducer(hydrationRequestReducer, {
    externalSessionId: null,
    status: "idle",
  });
  const lifecycle = deriveAgentSessionViewLifecycle({
    session: activeSession,
    repoReadinessState,
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
      repoReadinessState,
      ...(historyPreludeMode ? { historyPreludeMode } : {}),
      ...(persistedRecords ? { persistedRecords } : {}),
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
    ensureSessionReadyForView,
    historyPreludeMode,
    persistedRecords,
    repoReadinessState,
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
