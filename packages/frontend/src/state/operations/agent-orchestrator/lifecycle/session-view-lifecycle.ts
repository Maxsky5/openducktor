import type { AgentSessionRouteIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { getSessionMessageCount } from "../support/messages";

export type SessionRepoReadinessState = "ready" | "checking" | "blocked";

export type AgentSessionLifecycleSource = Pick<
  AgentSessionState,
  "externalSessionId" | "historyLoadState" | "messages"
>;
export type AgentSessionHistoryLoadState = AgentSessionLifecycleSource["historyLoadState"];
export type AgentSessionLifecycleTarget = {
  historyLoadState: AgentSessionHistoryLoadState;
  hasTranscript: boolean;
};

export type AgentSessionViewLifecyclePhase =
  | "inactive"
  | "resolving_session"
  | "resolving_runtime"
  | "waiting_for_runtime"
  | "needs_initial_history"
  | "needs_history"
  | "loading_history"
  | "refreshing_history"
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
  repoReadinessState: SessionRepoReadinessState;
};

export type SelectedAgentSessionViewLifecycle = AgentSessionViewLifecycle;

const inactiveSelectedSessionViewLifecycle: SelectedAgentSessionViewLifecycle = {
  phase: "inactive",
  repoReadinessState: "ready",
};

type AgentSessionViewLifecyclePhasePolicy = {
  transcriptState: AgentSessionTranscriptState;
  canReadRuntimeDataWhenRepoReady?: true;
  shouldLoadHistoryWhenRepoReady?: true;
  isResolving?: true;
};

const PHASE_POLICY: Record<AgentSessionViewLifecyclePhase, AgentSessionViewLifecyclePhasePolicy> = {
  inactive: { transcriptState: { kind: "empty" } },
  resolving_session: {
    transcriptState: { kind: "session_loading", reason: "preparing" },
    isResolving: true,
  },
  resolving_runtime: {
    transcriptState: { kind: "runtime_waiting" },
    isResolving: true,
  },
  waiting_for_runtime: { transcriptState: { kind: "runtime_waiting" } },
  needs_initial_history: {
    transcriptState: { kind: "session_loading", reason: "history" },
    canReadRuntimeDataWhenRepoReady: true,
    shouldLoadHistoryWhenRepoReady: true,
  },
  needs_history: {
    transcriptState: { kind: "visible" },
    canReadRuntimeDataWhenRepoReady: true,
    shouldLoadHistoryWhenRepoReady: true,
  },
  loading_history: {
    transcriptState: { kind: "session_loading", reason: "history" },
    canReadRuntimeDataWhenRepoReady: true,
  },
  refreshing_history: {
    transcriptState: { kind: "visible" },
    canReadRuntimeDataWhenRepoReady: true,
  },
  history_failed: {
    transcriptState: { kind: "failed" },
    canReadRuntimeDataWhenRepoReady: true,
  },
  ready: {
    transcriptState: { kind: "visible" },
    canReadRuntimeDataWhenRepoReady: true,
  },
};

export const getAgentSessionTranscriptState = ({
  phase,
}: Pick<AgentSessionViewLifecycle, "phase">): AgentSessionTranscriptState =>
  PHASE_POLICY[phase].transcriptState;

export const canReadAgentSessionRuntimeData = (
  lifecycle: SelectedAgentSessionViewLifecycle,
): boolean => {
  if (lifecycle.repoReadinessState !== "ready") {
    return false;
  }
  return PHASE_POLICY[lifecycle.phase].canReadRuntimeDataWhenRepoReady === true;
};

export const shouldLoadAgentSessionHistory = (
  lifecycle: SelectedAgentSessionViewLifecycle,
): boolean =>
  lifecycle.repoReadinessState === "ready" &&
  PHASE_POLICY[lifecycle.phase].shouldLoadHistoryWhenRepoReady === true;

export const isSelectedAgentSessionResolving = (
  lifecycle: Pick<SelectedAgentSessionViewLifecycle, "phase">,
): boolean => PHASE_POLICY[lifecycle.phase].isResolving === true;

export const isSelectedAgentSessionWaitingForRuntimeReadiness = (
  lifecycle: Pick<SelectedAgentSessionViewLifecycle, "phase">,
): boolean => PHASE_POLICY[lifecycle.phase].transcriptState.kind === "runtime_waiting";

export const isSelectedAgentSessionViewLoading = (
  lifecycle: Pick<SelectedAgentSessionViewLifecycle, "phase">,
): boolean => {
  const transcriptState = PHASE_POLICY[lifecycle.phase].transcriptState;
  return transcriptState.kind === "runtime_waiting" || transcriptState.kind === "session_loading";
};

const deriveLoadedSessionLifecycle = ({
  historyLoadState,
  hasTranscript,
  repoReadinessState,
}: {
  historyLoadState: AgentSessionHistoryLoadState;
  hasTranscript: boolean;
  repoReadinessState: SessionRepoReadinessState;
}): AgentSessionViewLifecycle => {
  if (repoReadinessState !== "ready" && historyLoadState !== "loaded" && !hasTranscript) {
    return {
      phase: "waiting_for_runtime",
      repoReadinessState,
    };
  }

  switch (historyLoadState) {
    case "loaded":
      return {
        phase: "ready",
        repoReadinessState,
      };
    case "loading":
      return {
        phase: hasTranscript ? "refreshing_history" : "loading_history",
        repoReadinessState,
      };
    case "not_requested":
      return {
        phase: hasTranscript ? "needs_history" : "needs_initial_history",
        repoReadinessState,
      };
    case "failed":
      return {
        phase: hasTranscript ? "needs_history" : "history_failed",
        repoReadinessState,
      };
  }
};

export const deriveAgentSessionTargetViewLifecycle = ({
  target,
  repoReadinessState,
}: {
  target: AgentSessionLifecycleTarget | null;
  repoReadinessState: SessionRepoReadinessState;
}): AgentSessionViewLifecycle => {
  if (!target) {
    return {
      phase: "inactive",
      repoReadinessState,
    };
  }

  return deriveLoadedSessionLifecycle({
    historyLoadState: target.historyLoadState,
    hasTranscript: target.hasTranscript,
    repoReadinessState,
  });
};

export const deriveAgentSessionViewLifecycle = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionLifecycleSource | null;
  repoReadinessState: SessionRepoReadinessState;
}): AgentSessionViewLifecycle => {
  return deriveAgentSessionTargetViewLifecycle({
    target: session
      ? {
          historyLoadState: session.historyLoadState,
          hasTranscript: getSessionMessageCount(session) > 0,
        }
      : null,
    repoReadinessState,
  });
};

export const deriveSelectedAgentSessionViewLifecycle = ({
  selectedSessionRoute,
  session,
  hasSelectedTask,
  repoReadinessState,
  sessionLoadError,
  isLoadingTaskSessionRecords = false,
}: {
  selectedSessionRoute: AgentSessionRouteIdentity | null;
  session: AgentSessionState | null;
  hasSelectedTask: boolean;
  repoReadinessState: SessionRepoReadinessState;
  sessionLoadError?: string | null;
  isLoadingTaskSessionRecords?: boolean;
}): SelectedAgentSessionViewLifecycle => {
  if (sessionLoadError && selectedSessionRoute === null && hasSelectedTask) {
    return {
      phase: "history_failed",
      repoReadinessState,
    };
  }

  if (!selectedSessionRoute) {
    if (hasSelectedTask && repoReadinessState !== "ready") {
      return {
        phase: "waiting_for_runtime",
        repoReadinessState,
      };
    }
    if (hasSelectedTask && isLoadingTaskSessionRecords) {
      return {
        phase: "resolving_session",
        repoReadinessState,
      };
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
      repoReadinessState,
    };
  }

  return deriveAgentSessionViewLifecycle({ session, repoReadinessState });
};
