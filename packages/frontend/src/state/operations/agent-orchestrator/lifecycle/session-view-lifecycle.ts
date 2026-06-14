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
  transcriptState: AgentSessionTranscriptState;
  canReadRuntimeData: boolean;
  shouldLoadHistory: boolean;
  isResolving: boolean;
  isRuntimeWaiting: boolean;
  isLoading: boolean;
};

export type SelectedAgentSessionViewLifecycle = AgentSessionViewLifecycle;

const lifecycle = ({
  phase,
  repoReadinessState,
  transcriptState,
  canReadRuntimeDataWhenReady = false,
  shouldLoadHistoryWhenReady = false,
  isResolving = false,
}: {
  phase: AgentSessionViewLifecyclePhase;
  repoReadinessState: SessionRepoReadinessState;
  transcriptState: AgentSessionTranscriptState;
  canReadRuntimeDataWhenReady?: boolean;
  shouldLoadHistoryWhenReady?: boolean;
  isResolving?: boolean;
}): AgentSessionViewLifecycle => ({
  phase,
  repoReadinessState,
  transcriptState,
  canReadRuntimeData: repoReadinessState === "ready" && canReadRuntimeDataWhenReady,
  shouldLoadHistory: repoReadinessState === "ready" && shouldLoadHistoryWhenReady,
  isResolving,
  isRuntimeWaiting: transcriptState.kind === "runtime_waiting",
  isLoading:
    transcriptState.kind === "runtime_waiting" || transcriptState.kind === "session_loading",
});

const inactiveSelectedSessionViewLifecycle: SelectedAgentSessionViewLifecycle = lifecycle({
  phase: "inactive",
  repoReadinessState: "ready",
  transcriptState: { kind: "empty" },
});

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
    return lifecycle({
      phase: "waiting_for_runtime",
      repoReadinessState,
      transcriptState: { kind: "runtime_waiting" },
    });
  }

  switch (historyLoadState) {
    case "loaded":
      return lifecycle({
        phase: "ready",
        repoReadinessState,
        transcriptState: { kind: "visible" },
        canReadRuntimeDataWhenReady: true,
      });
    case "loading":
      return lifecycle({
        phase: hasTranscript ? "refreshing_history" : "loading_history",
        repoReadinessState,
        transcriptState: hasTranscript
          ? { kind: "visible" }
          : { kind: "session_loading", reason: "history" },
        canReadRuntimeDataWhenReady: true,
      });
    case "not_requested":
      return lifecycle({
        phase: hasTranscript ? "needs_history" : "needs_initial_history",
        repoReadinessState,
        transcriptState: hasTranscript
          ? { kind: "visible" }
          : { kind: "session_loading", reason: "history" },
        canReadRuntimeDataWhenReady: true,
        shouldLoadHistoryWhenReady: true,
      });
    case "failed":
      return lifecycle({
        phase: hasTranscript ? "needs_history" : "history_failed",
        repoReadinessState,
        transcriptState: hasTranscript ? { kind: "visible" } : { kind: "failed" },
        canReadRuntimeDataWhenReady: true,
        shouldLoadHistoryWhenReady: hasTranscript,
      });
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
    return lifecycle({
      phase: "inactive",
      repoReadinessState,
      transcriptState: { kind: "empty" },
    });
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
    return lifecycle({
      phase: "history_failed",
      repoReadinessState,
      transcriptState: { kind: "failed" },
      canReadRuntimeDataWhenReady: true,
    });
  }

  if (!selectedSessionRoute) {
    if (hasSelectedTask && repoReadinessState !== "ready") {
      return lifecycle({
        phase: "waiting_for_runtime",
        repoReadinessState,
        transcriptState: { kind: "runtime_waiting" },
      });
    }
    if (hasSelectedTask && isLoadingTaskSessionRecords) {
      return lifecycle({
        phase: "resolving_session",
        repoReadinessState,
        transcriptState: { kind: "session_loading", reason: "preparing" },
        isResolving: true,
      });
    }
    return inactiveSelectedSessionViewLifecycle;
  }

  if (!session) {
    const hasLoadFailed = sessionLoadError !== null && sessionLoadError !== undefined;
    if (hasLoadFailed) {
      return lifecycle({
        phase: "history_failed",
        repoReadinessState,
        transcriptState: { kind: "failed" },
        canReadRuntimeDataWhenReady: true,
      });
    }
    if (repoReadinessState !== "ready") {
      return lifecycle({
        phase: "resolving_runtime",
        repoReadinessState,
        transcriptState: { kind: "runtime_waiting" },
        isResolving: true,
      });
    }
    return lifecycle({
      phase: "resolving_session",
      repoReadinessState,
      transcriptState: { kind: "session_loading", reason: "preparing" },
      isResolving: true,
    });
  }

  return deriveAgentSessionViewLifecycle({ session, repoReadinessState });
};
