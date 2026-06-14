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
};

export type SelectedAgentSessionViewLifecycle = AgentSessionViewLifecycle;

const lifecycle = ({
  repoReadinessState,
  transcriptState,
}: {
  repoReadinessState: SessionRepoReadinessState;
  transcriptState: AgentSessionTranscriptState;
}): AgentSessionViewLifecycle => ({
  repoReadinessState,
  transcriptState,
});

export const isAgentSessionTranscriptLoading = (
  transcriptState: AgentSessionTranscriptState,
): boolean =>
  transcriptState.kind === "runtime_waiting" || transcriptState.kind === "session_loading";

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
      });
    case "loading":
      return lifecycle({
        repoReadinessState,
        transcriptState: hasTranscript
          ? { kind: "visible" }
          : { kind: "session_loading", reason: "history" },
      });
    case "not_requested":
      return lifecycle({
        repoReadinessState,
        transcriptState: hasTranscript
          ? { kind: "visible" }
          : { kind: "session_loading", reason: "history" },
      });
    case "failed":
      return lifecycle({
        repoReadinessState,
        transcriptState: hasTranscript ? { kind: "visible" } : { kind: "failed" },
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
  isLoadingSessionReadModel = false,
}: {
  selectedSessionRoute: AgentSessionRouteIdentity | null;
  session: AgentSessionState | null;
  hasSelectedTask: boolean;
  repoReadinessState: SessionRepoReadinessState;
  sessionLoadError?: string | null;
  isLoadingSessionReadModel?: boolean;
}): SelectedAgentSessionViewLifecycle => {
  if (sessionLoadError && selectedSessionRoute === null && hasSelectedTask) {
    return lifecycle({
      repoReadinessState,
      transcriptState: { kind: "failed" },
    });
  }

  if (!selectedSessionRoute) {
    if (hasSelectedTask && repoReadinessState !== "ready") {
      return lifecycle({
        repoReadinessState,
        transcriptState: { kind: "runtime_waiting" },
      });
    }
    if (hasSelectedTask && isLoadingSessionReadModel) {
      return lifecycle({
        repoReadinessState,
        transcriptState: { kind: "session_loading", reason: "preparing" },
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
      });
    }
    if (repoReadinessState !== "ready") {
      return lifecycle({
        repoReadinessState,
        transcriptState: { kind: "runtime_waiting" },
      });
    }
    return lifecycle({
      repoReadinessState,
      transcriptState: { kind: "session_loading", reason: "preparing" },
    });
  }

  return deriveAgentSessionViewLifecycle({ session, repoReadinessState });
};
