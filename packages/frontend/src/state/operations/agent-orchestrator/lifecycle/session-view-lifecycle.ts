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

export type AgentSessionTranscriptState =
  | { kind: "empty" }
  | { kind: "runtime_waiting" }
  | { kind: "session_loading"; reason: "preparing" | "history" }
  | { kind: "visible" }
  | { kind: "failed" };

export type AgentSessionViewLifecycle = {
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
  repoReadinessState,
  transcriptState,
  canReadRuntimeDataWhenReady = false,
  shouldLoadHistoryWhenReady = false,
  isResolving = false,
}: {
  repoReadinessState: SessionRepoReadinessState;
  transcriptState: AgentSessionTranscriptState;
  canReadRuntimeDataWhenReady?: boolean;
  shouldLoadHistoryWhenReady?: boolean;
  isResolving?: boolean;
}): AgentSessionViewLifecycle => ({
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
      repoReadinessState,
      transcriptState: { kind: "runtime_waiting" },
    });
  }

  switch (historyLoadState) {
    case "loaded":
      return lifecycle({
        repoReadinessState,
        transcriptState: { kind: "visible" },
        canReadRuntimeDataWhenReady: true,
      });
    case "loading":
      return lifecycle({
        repoReadinessState,
        transcriptState: hasTranscript
          ? { kind: "visible" }
          : { kind: "session_loading", reason: "history" },
        canReadRuntimeDataWhenReady: true,
      });
    case "not_requested":
      return lifecycle({
        repoReadinessState,
        transcriptState: hasTranscript
          ? { kind: "visible" }
          : { kind: "session_loading", reason: "history" },
        canReadRuntimeDataWhenReady: true,
        shouldLoadHistoryWhenReady: true,
      });
    case "failed":
      return lifecycle({
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
      repoReadinessState,
      transcriptState: { kind: "failed" },
      canReadRuntimeDataWhenReady: true,
    });
  }

  if (!selectedSessionRoute) {
    if (hasSelectedTask && repoReadinessState !== "ready") {
      return lifecycle({
        repoReadinessState,
        transcriptState: { kind: "runtime_waiting" },
      });
    }
    if (hasSelectedTask && isLoadingTaskSessionRecords) {
      return lifecycle({
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
        repoReadinessState,
        transcriptState: { kind: "failed" },
        canReadRuntimeDataWhenReady: true,
      });
    }
    if (repoReadinessState !== "ready") {
      return lifecycle({
        repoReadinessState,
        transcriptState: { kind: "runtime_waiting" },
        isResolving: true,
      });
    }
    return lifecycle({
      repoReadinessState,
      transcriptState: { kind: "session_loading", reason: "preparing" },
      isResolving: true,
    });
  }

  return deriveAgentSessionViewLifecycle({ session, repoReadinessState });
};
