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
  phase: SelectedAgentSessionViewLifecyclePhase;
  canRenderHistory: boolean;
  historyRequest: AgentSessionHistoryRequest;
};

type SelectedAgentSessionLifecyclePhaseInput = Pick<SelectedAgentSessionViewLifecycle, "phase">;

type SelectedAgentSessionLifecycleHistoryInput = Pick<
  SelectedAgentSessionViewLifecycle,
  "historyRequest"
>;

const inactiveSelectedSessionViewLifecycle: SelectedAgentSessionViewLifecycle = {
  externalSessionId: null,
  phase: "inactive",
  canRenderHistory: false,
  historyRequest: "none",
};

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
  canReadRuntimeData: repoReadinessState === "ready" && phase !== "idle",
  canRenderHistory,
  historyRequest,
});

export const shouldEnsureAgentSessionReadyForView = (
  lifecycle: AgentSessionViewLifecycle,
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

export const shouldEnsureSelectedAgentSessionReadyForView = (
  lifecycle: SelectedAgentSessionLifecycleHistoryInput,
): boolean => lifecycle.historyRequest === "load";

const toSelectedSessionLifecyclePhase = ({
  lifecycle,
}: {
  lifecycle: AgentSessionViewLifecycle;
}): SelectedAgentSessionViewLifecyclePhase => {
  switch (lifecycle.phase) {
    case "idle":
      return "inactive";
    case "blocked_on_repo":
      return "waiting_for_runtime";
    case "history_failed":
      return "history_failed";
    case "loading_history":
      return "loading_history";
    case "needs_history":
      return lifecycle.canRenderHistory ? "needs_history" : "loading_history";
    case "ready":
      return "ready";
  }
};

export const deriveAgentSessionViewLifecycle = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState | null;
  repoReadinessState: SessionRepoReadinessState;
}): AgentSessionViewLifecycle => {
  if (!session) {
    return createAgentSessionViewLifecycle({
      phase: "idle",
      repoReadinessState,
    });
  }

  const sessionNeedsHistoryLoad = requiresLoadedAgentSessionHistory(session);
  const historyLoadState = getAgentSessionHistoryLoadState(session);
  const hasTranscript = getSessionMessageCount(session) > 0;

  if (repoReadinessState !== "ready" && sessionNeedsHistoryLoad && !hasTranscript) {
    return createAgentSessionViewLifecycle({
      phase: "blocked_on_repo",
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
      phase: "needs_history",
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
      canRenderHistory: false,
      historyRequest: "none",
    };
  }

  const lifecycle = deriveAgentSessionViewLifecycle({ session, repoReadinessState });

  return {
    externalSessionId: selectedSessionRoute.externalSessionId,
    phase: toSelectedSessionLifecyclePhase({ lifecycle }),
    canRenderHistory: lifecycle.canRenderHistory,
    historyRequest: lifecycle.historyRequest,
  };
};
