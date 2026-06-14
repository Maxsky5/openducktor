import type { AgentSessionRouteIdentity, AgentSessionState } from "@/types/agent-orchestrator";
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

export type AgentSessionViewLifecycle = {
  phase: AgentSessionViewLifecyclePhase;
  canReadRuntimeData: boolean;
  canRenderHistory: boolean;
  shouldLoadHistory: boolean;
};

export type SelectedAgentSessionViewLifecycle = AgentSessionViewLifecycle;

type SelectedAgentSessionLifecyclePhaseInput = Pick<SelectedAgentSessionViewLifecycle, "phase">;

const inactiveSelectedSessionViewLifecycle: SelectedAgentSessionViewLifecycle = {
  phase: "inactive",
  canReadRuntimeData: false,
  canRenderHistory: false,
  shouldLoadHistory: false,
};

export const createResolvingSelectedSessionViewLifecycle =
  (): SelectedAgentSessionViewLifecycle => ({
    phase: "resolving_session",
    canReadRuntimeData: false,
    canRenderHistory: false,
    shouldLoadHistory: false,
  });

export const createFailedSelectedSessionViewLifecycle = (): SelectedAgentSessionViewLifecycle => ({
  phase: "history_failed",
  canReadRuntimeData: false,
  canRenderHistory: false,
  shouldLoadHistory: false,
});

const createAgentSessionViewLifecycle = ({
  phase,
  repoReadinessState,
  canRenderHistory = false,
  shouldLoadHistory = false,
}: {
  phase: AgentSessionViewLifecyclePhase;
  repoReadinessState: SessionRepoReadinessState;
  canRenderHistory?: boolean;
  shouldLoadHistory?: boolean;
}): AgentSessionViewLifecycle => ({
  phase,
  canReadRuntimeData: repoReadinessState === "ready" && phase !== "inactive",
  canRenderHistory,
  shouldLoadHistory,
});

export const isSelectedAgentSessionResolving = (
  lifecycle: SelectedAgentSessionLifecyclePhaseInput,
): boolean => lifecycle.phase === "resolving_session" || lifecycle.phase === "resolving_runtime";

export const isSelectedAgentSessionWaitingForRuntimeReadiness = (
  lifecycle: SelectedAgentSessionLifecyclePhaseInput,
): boolean => lifecycle.phase === "resolving_runtime" || lifecycle.phase === "waiting_for_runtime";

export const isSelectedAgentSessionViewLoading = (
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

  const historyLoadState = session.historyLoadState;
  const hasTranscript = getSessionMessageCount(session) > 0;

  if (repoReadinessState !== "ready" && historyLoadState !== "loaded" && !hasTranscript) {
    return createAgentSessionViewLifecycle({
      phase: "waiting_for_runtime",
      repoReadinessState,
    });
  }

  switch (historyLoadState) {
    case "loaded":
      return createAgentSessionViewLifecycle({
        phase: "ready",
        repoReadinessState,
        canRenderHistory: true,
      });
    case "loading":
      return createAgentSessionViewLifecycle({
        phase: "loading_history",
        repoReadinessState,
        canRenderHistory: hasTranscript,
      });
    case "not_requested":
      return createAgentSessionViewLifecycle({
        phase: hasTranscript ? "needs_history" : "loading_history",
        repoReadinessState,
        canRenderHistory: hasTranscript,
        shouldLoadHistory: repoReadinessState === "ready",
      });
    case "failed":
      return createAgentSessionViewLifecycle({
        phase: hasTranscript ? "needs_history" : "history_failed",
        repoReadinessState,
        canRenderHistory: hasTranscript,
        shouldLoadHistory: repoReadinessState === "ready",
      });
  }
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
      phase: hasLoadFailed
        ? "history_failed"
        : repoReadinessState !== "ready"
          ? "resolving_runtime"
          : "resolving_session",
      canReadRuntimeData: false,
      canRenderHistory: false,
      shouldLoadHistory: false,
    };
  }

  return deriveAgentSessionViewLifecycle({ session, repoReadinessState });
};
