import type { AgentSessionRouteIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  getAgentSessionHistoryLoadState,
  requiresLoadedAgentSessionHistory,
} from "../support/history-load-state";
import { getSessionMessageCount } from "../support/messages";

export type SessionRepoReadinessState = "ready" | "checking" | "blocked";

export type AgentSessionViewLifecyclePhase =
  | "idle"
  | "blocked_on_repo"
  | "needs_history"
  | "loading_history"
  | "history_failed"
  | "ready";

export type SelectedAgentSessionViewLifecyclePhase =
  | "inactive"
  | "resolving_session"
  | "waiting_for_runtime"
  | "needs_history"
  | "loading_history"
  | "history_failed"
  | "ready";

export type AgentSessionViewLifecycle = {
  phase: AgentSessionViewLifecyclePhase;
  canReadRuntimeData: boolean;
  canRenderHistory: boolean;
  isWaitingForRuntimeReadiness: boolean;
  isLoadingHistory: boolean;
  isHistoryLoadFailed: boolean;
  shouldEnsureReadyForView: boolean;
};

export type SelectedAgentSessionViewLifecycle = {
  externalSessionId: string | null;
  phase: SelectedAgentSessionViewLifecyclePhase;
  canRenderHistory: boolean;
  isResolvingSession: boolean;
  isLoadingHistory: boolean;
  isHistoryLoadFailed: boolean;
  isWaitingForRuntimeReadiness: boolean;
  shouldEnsureReadyForView: boolean;
};

const inactiveSelectedSessionViewLifecycle: SelectedAgentSessionViewLifecycle = {
  externalSessionId: null,
  phase: "inactive",
  canRenderHistory: false,
  isResolvingSession: false,
  isLoadingHistory: false,
  isHistoryLoadFailed: false,
  isWaitingForRuntimeReadiness: false,
  shouldEnsureReadyForView: false,
};

export type AgentStudioSelectedSessionLifecycle = SelectedAgentSessionViewLifecycle & {
  isTaskViewResolving: boolean;
  isSessionSelectionResolving: boolean;
};

export const isSelectedSessionHistoryBlockingRender = (
  lifecycle: Pick<SelectedAgentSessionViewLifecycle, "canRenderHistory" | "isLoadingHistory">,
): boolean => lifecycle.isLoadingHistory && !lifecycle.canRenderHistory;

export const deriveAgentStudioSelectedSessionLifecycle = ({
  taskId,
  isActiveTaskReady,
  isActiveTaskReadinessFailed,
  isSessionSelectionResolving,
  isRuntimeStarting,
  selectedSessionLifecycle,
}: {
  taskId: string;
  isActiveTaskReady: boolean;
  isActiveTaskReadinessFailed: boolean;
  isSessionSelectionResolving: boolean;
  isRuntimeStarting: boolean;
  selectedSessionLifecycle: SelectedAgentSessionViewLifecycle;
}): AgentStudioSelectedSessionLifecycle => ({
  ...selectedSessionLifecycle,
  isTaskViewResolving: Boolean(taskId && !isActiveTaskReady && !isActiveTaskReadinessFailed),
  isSessionSelectionResolving,
  isWaitingForRuntimeReadiness:
    selectedSessionLifecycle.isWaitingForRuntimeReadiness || (Boolean(taskId) && isRuntimeStarting),
});

const toSelectedSessionLifecyclePhase = ({
  lifecycle,
  isLoadingHistory,
}: {
  lifecycle: AgentSessionViewLifecycle;
  isLoadingHistory: boolean;
}): SelectedAgentSessionViewLifecyclePhase => {
  if (lifecycle.phase === "blocked_on_repo") {
    return "waiting_for_runtime";
  }
  if (lifecycle.isHistoryLoadFailed) {
    return "history_failed";
  }
  if (isLoadingHistory) {
    return "loading_history";
  }
  if (lifecycle.phase === "idle") {
    return "inactive";
  }
  return lifecycle.phase;
};

export const deriveAgentSessionViewLifecycle = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: SessionRepoReadinessState;
}): AgentSessionViewLifecycle => {
  if (!session) {
    return {
      phase: "idle",
      canReadRuntimeData: false,
      canRenderHistory: false,
      isWaitingForRuntimeReadiness: false,
      isLoadingHistory: false,
      isHistoryLoadFailed: false,
      shouldEnsureReadyForView: false,
    };
  }

  const sessionNeedsHistoryLoad = requiresLoadedAgentSessionHistory(session);
  const historyLoadState = getAgentSessionHistoryLoadState(session);
  const hasTranscript = getSessionMessageCount(session) > 0;

  if (repoReadinessState !== "ready" && sessionNeedsHistoryLoad && !hasTranscript) {
    return {
      phase: "blocked_on_repo",
      canReadRuntimeData: false,
      canRenderHistory: false,
      isWaitingForRuntimeReadiness: true,
      isLoadingHistory: false,
      isHistoryLoadFailed: false,
      shouldEnsureReadyForView: false,
    };
  }

  if (!sessionNeedsHistoryLoad) {
    return {
      phase: "ready",
      canReadRuntimeData: repoReadinessState === "ready",
      canRenderHistory: true,
      isWaitingForRuntimeReadiness: false,
      isLoadingHistory: false,
      isHistoryLoadFailed: false,
      shouldEnsureReadyForView: false,
    };
  }

  if (historyLoadState === "loading") {
    return {
      phase: "loading_history",
      canReadRuntimeData: repoReadinessState === "ready",
      canRenderHistory: hasTranscript,
      isWaitingForRuntimeReadiness: false,
      isLoadingHistory: true,
      isHistoryLoadFailed: false,
      shouldEnsureReadyForView: false,
    };
  }

  if (historyLoadState === "not_requested") {
    return {
      phase: "needs_history",
      canReadRuntimeData: repoReadinessState === "ready",
      canRenderHistory: hasTranscript,
      isWaitingForRuntimeReadiness: false,
      isLoadingHistory: false,
      isHistoryLoadFailed: false,
      shouldEnsureReadyForView: repoReadinessState === "ready",
    };
  }

  if (historyLoadState === "failed" && hasTranscript) {
    return {
      phase: "needs_history",
      canReadRuntimeData: repoReadinessState === "ready",
      canRenderHistory: true,
      isWaitingForRuntimeReadiness: false,
      isLoadingHistory: false,
      isHistoryLoadFailed: false,
      shouldEnsureReadyForView: repoReadinessState === "ready",
    };
  }

  const shouldShowBlockingHistoryFailure = !hasTranscript && historyLoadState === "failed";
  if (shouldShowBlockingHistoryFailure) {
    return {
      phase: "history_failed",
      canReadRuntimeData: repoReadinessState === "ready",
      canRenderHistory: false,
      isWaitingForRuntimeReadiness: false,
      isLoadingHistory: false,
      isHistoryLoadFailed: true,
      shouldEnsureReadyForView: repoReadinessState === "ready",
    };
  }

  return {
    phase: "ready",
    canReadRuntimeData: repoReadinessState === "ready",
    canRenderHistory: hasTranscript || historyLoadState === "loaded",
    isWaitingForRuntimeReadiness: false,
    isLoadingHistory: false,
    isHistoryLoadFailed: false,
    shouldEnsureReadyForView: false,
  };
};

export const deriveSelectedAgentSessionViewLifecycle = ({
  selectedSessionRoute,
  session,
  repoReadinessState,
  sessionLoadError,
}: {
  selectedSessionRoute: AgentSessionRouteIdentity | null;
  session: AgentSessionState | null;
  repoReadinessState: SessionRepoReadinessState;
  sessionLoadError?: string | null;
}): SelectedAgentSessionViewLifecycle => {
  if (!selectedSessionRoute) {
    return inactiveSelectedSessionViewLifecycle;
  }

  if (!session) {
    const hasLoadFailed = sessionLoadError !== null && sessionLoadError !== undefined;
    const isWaitingForRuntimeReadiness = !hasLoadFailed && repoReadinessState !== "ready";
    return {
      externalSessionId: selectedSessionRoute.externalSessionId,
      phase: hasLoadFailed
        ? "history_failed"
        : isWaitingForRuntimeReadiness
          ? "waiting_for_runtime"
          : "resolving_session",
      canRenderHistory: false,
      isResolvingSession: !hasLoadFailed,
      isLoadingHistory: !hasLoadFailed,
      isHistoryLoadFailed: hasLoadFailed,
      isWaitingForRuntimeReadiness,
      shouldEnsureReadyForView: false,
    };
  }

  const lifecycle = deriveAgentSessionViewLifecycle({ session, repoReadinessState });
  const isHistoryLoadFailed = lifecycle.isHistoryLoadFailed;
  const isWaitingForRuntimeReadiness =
    !isHistoryLoadFailed && lifecycle.isWaitingForRuntimeReadiness;
  const isLoadingHistory =
    !isHistoryLoadFailed &&
    !lifecycle.canRenderHistory &&
    (isWaitingForRuntimeReadiness ||
      lifecycle.isLoadingHistory ||
      lifecycle.shouldEnsureReadyForView);

  return {
    externalSessionId: selectedSessionRoute.externalSessionId,
    phase: toSelectedSessionLifecyclePhase({ lifecycle, isLoadingHistory }),
    canRenderHistory: lifecycle.canRenderHistory,
    isResolvingSession: false,
    isLoadingHistory,
    isHistoryLoadFailed,
    isWaitingForRuntimeReadiness,
    shouldEnsureReadyForView: lifecycle.shouldEnsureReadyForView,
  };
};
