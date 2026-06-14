import type { AgentSessionRouteIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import {
  getAgentSessionHistoryLoadState,
  requiresLoadedAgentSessionHistory,
} from "../support/history-load-state";
import { getSessionMessageCount } from "../support/messages";

export type SessionRepoReadinessState = "ready" | "checking" | "blocked";

export type AgentSessionViewLifecyclePhase =
  | "inactive"
  | "resolving_session"
  | "resolving_runtime"
  | "waiting_for_runtime"
  | "needs_history"
  | "loading_history"
  | "history_failed"
  | "ready";

export type AgentSessionHistoryRequest = "none" | "load";

export type AgentSessionViewLifecycle = {
  phase: AgentSessionViewLifecyclePhase;
  canReadRuntimeData: boolean;
  canRenderHistory: boolean;
  historyRequest: AgentSessionHistoryRequest;
};

export type SelectedAgentSessionViewLifecycle = {
  externalSessionId: string | null;
  phase: AgentSessionViewLifecyclePhase;
  canReadRuntimeData: boolean;
  canRenderHistory: boolean;
  historyRequest: AgentSessionHistoryRequest;
};

type SelectedAgentSessionLifecyclePhaseInput = Pick<SelectedAgentSessionViewLifecycle, "phase">;

type AgentSessionLifecycleHistoryInput = Pick<AgentSessionViewLifecycle, "historyRequest">;

const inactiveSelectedSessionViewLifecycle: SelectedAgentSessionViewLifecycle = {
  externalSessionId: null,
  phase: "inactive",
  canReadRuntimeData: false,
  canRenderHistory: false,
  historyRequest: "none",
};

export const createResolvingSelectedSessionViewLifecycle = (
  externalSessionId: string | null = null,
): SelectedAgentSessionViewLifecycle => ({
  externalSessionId,
  phase: "resolving_session",
  canReadRuntimeData: false,
  canRenderHistory: false,
  historyRequest: "none",
});

export const createFailedSelectedSessionViewLifecycle = (
  externalSessionId: string | null = null,
): SelectedAgentSessionViewLifecycle => ({
  externalSessionId,
  phase: "history_failed",
  canReadRuntimeData: false,
  canRenderHistory: false,
  historyRequest: "none",
});

const createAgentSessionViewLifecycle = ({
  phase,
  repoReadinessState,
  canRenderHistory = false,
  historyRequest = "none",
}: {
  phase: AgentSessionViewLifecyclePhase;
  repoReadinessState: SessionRepoReadinessState;
  canRenderHistory?: boolean;
  historyRequest?: AgentSessionHistoryRequest;
}): AgentSessionViewLifecycle => ({
  phase,
  canReadRuntimeData: repoReadinessState === "ready" && phase !== "inactive",
  canRenderHistory,
  historyRequest,
});

export const shouldEnsureAgentSessionReadyForView = (
  lifecycle: AgentSessionLifecycleHistoryInput,
): boolean => lifecycle.historyRequest === "load";

export const isSelectedAgentSessionResolving = (
  lifecycle: SelectedAgentSessionLifecyclePhaseInput,
): boolean => lifecycle.phase === "resolving_session" || lifecycle.phase === "resolving_runtime";

export const isSelectedAgentSessionWaitingForRuntimeReadiness = (
  lifecycle: SelectedAgentSessionLifecyclePhaseInput,
): boolean => lifecycle.phase === "resolving_runtime" || lifecycle.phase === "waiting_for_runtime";

export const isSelectedAgentSessionHistoryLoading = (
  lifecycle: SelectedAgentSessionLifecyclePhaseInput,
): boolean =>
  lifecycle.phase === "resolving_session" ||
  lifecycle.phase === "resolving_runtime" ||
  lifecycle.phase === "waiting_for_runtime" ||
  lifecycle.phase === "loading_history";

export const deriveAgentSessionViewLifecycle = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: SessionRepoReadinessState;
}): AgentSessionViewLifecycle => {
  if (!session) {
    return createAgentSessionViewLifecycle({
      phase: "inactive",
      repoReadinessState,
    });
  }

  const sessionNeedsHistoryLoad = requiresLoadedAgentSessionHistory(session);
  const historyLoadState = getAgentSessionHistoryLoadState(session);
  const hasTranscript = getSessionMessageCount(session) > 0;

  if (repoReadinessState !== "ready" && sessionNeedsHistoryLoad && !hasTranscript) {
    return createAgentSessionViewLifecycle({
      phase: "waiting_for_runtime",
      repoReadinessState,
    });
  }

  if (!sessionNeedsHistoryLoad) {
    return createAgentSessionViewLifecycle({
      phase: "ready",
      repoReadinessState,
      canRenderHistory: true,
    });
  }

  if (historyLoadState === "loading") {
    return createAgentSessionViewLifecycle({
      phase: "loading_history",
      repoReadinessState,
      canRenderHistory: hasTranscript,
    });
  }

  if (historyLoadState === "not_requested") {
    return createAgentSessionViewLifecycle({
      phase: hasTranscript ? "needs_history" : "loading_history",
      repoReadinessState,
      canRenderHistory: hasTranscript,
      historyRequest: repoReadinessState === "ready" ? "load" : "none",
    });
  }

  if (historyLoadState === "failed" && hasTranscript) {
    return createAgentSessionViewLifecycle({
      phase: "needs_history",
      repoReadinessState,
      canRenderHistory: true,
      historyRequest: repoReadinessState === "ready" ? "load" : "none",
    });
  }

  const shouldShowBlockingHistoryFailure = !hasTranscript && historyLoadState === "failed";
  if (shouldShowBlockingHistoryFailure) {
    return createAgentSessionViewLifecycle({
      phase: "history_failed",
      repoReadinessState,
      historyRequest: repoReadinessState === "ready" ? "load" : "none",
    });
  }

  return createAgentSessionViewLifecycle({
    phase: "ready",
    repoReadinessState,
    canRenderHistory: hasTranscript || historyLoadState === "loaded",
  });
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
    return {
      externalSessionId: selectedSessionRoute.externalSessionId,
      phase: hasLoadFailed
        ? "history_failed"
        : repoReadinessState !== "ready"
          ? "resolving_runtime"
          : "resolving_session",
      canReadRuntimeData: false,
      canRenderHistory: false,
      historyRequest: "none",
    };
  }

  const lifecycle = deriveAgentSessionViewLifecycle({ session, repoReadinessState });

  return {
    externalSessionId: selectedSessionRoute.externalSessionId,
    phase: lifecycle.phase,
    canReadRuntimeData: lifecycle.canReadRuntimeData,
    canRenderHistory: lifecycle.canRenderHistory,
    historyRequest: lifecycle.historyRequest,
  };
};
