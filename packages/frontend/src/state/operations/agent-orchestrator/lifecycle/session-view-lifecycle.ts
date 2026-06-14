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

export type AgentSessionTranscriptState =
  | { kind: "empty" }
  | { kind: "runtime_waiting" }
  | { kind: "session_loading"; reason: "preparing" | "history" }
  | { kind: "visible" }
  | { kind: "failed" };

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

export const getAgentSessionTranscriptState = ({
  phase,
  canRenderHistory,
}: Pick<AgentSessionViewLifecycle, "phase" | "canRenderHistory">): AgentSessionTranscriptState => {
  switch (phase) {
    case "inactive":
      return { kind: "empty" };
    case "resolving_runtime":
    case "waiting_for_runtime":
      return { kind: "runtime_waiting" };
    case "resolving_session":
      return { kind: "session_loading", reason: "preparing" };
    case "loading_history":
      return canRenderHistory
        ? { kind: "visible" }
        : { kind: "session_loading", reason: "history" };
    case "history_failed":
      return canRenderHistory ? { kind: "visible" } : { kind: "failed" };
    case "needs_history":
    case "ready":
      return { kind: "visible" };
  }
};

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
  hasSelectedTask,
  repoReadinessState,
  sessionLoadError,
}: {
  selectedSessionRoute: AgentSessionRouteIdentity | null;
  session: AgentSessionState | null;
  hasSelectedTask: boolean;
  repoReadinessState: SessionRepoReadinessState;
  sessionLoadError?: string | null;
}): SelectedAgentSessionViewLifecycle => {
  if (!selectedSessionRoute) {
    if (hasSelectedTask && repoReadinessState !== "ready") {
      return createAgentSessionViewLifecycle({
        phase: "waiting_for_runtime",
        repoReadinessState,
      });
    }
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
