import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { getSessionMessageCount } from "../support/messages";

export type SessionRepoReadinessState = "ready" | "checking" | "blocked";

export type AgentSessionHistoryLoadState = AgentSessionState["historyLoadState"];
type AgentSessionTranscriptSnapshot = {
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

export const isAgentSessionTranscriptVisible = (
  transcriptState: AgentSessionTranscriptState,
): boolean => transcriptState.kind === "visible";

const inactiveSelectedSessionViewLifecycle: AgentSessionViewLifecycle = lifecycle({
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
  if (hasTranscript || historyLoadState === "loaded") {
    return lifecycle({
      repoReadinessState,
      transcriptState: { kind: "visible" },
    });
  }

  if (repoReadinessState !== "ready") {
    return lifecycle({
      repoReadinessState,
      transcriptState: { kind: "runtime_waiting" },
    });
  }

  if (historyLoadState === "failed") {
    return lifecycle({
      repoReadinessState,
      transcriptState: { kind: "failed" },
    });
  }

  return lifecycle({
    repoReadinessState,
    transcriptState: { kind: "session_loading", reason: "history" },
  });
};

const deriveMissingSelectedSessionLifecycle = ({
  hasSelectedTask,
  hasSelectedSessionIdentity,
  repoReadinessState,
  sessionLoadError,
  isLoadingSessionReadModel,
}: {
  hasSelectedTask: boolean;
  hasSelectedSessionIdentity: boolean;
  repoReadinessState: SessionRepoReadinessState;
  sessionLoadError: string | null | undefined;
  isLoadingSessionReadModel: boolean;
}): AgentSessionViewLifecycle => {
  const hasSelectionContext = hasSelectedTask || hasSelectedSessionIdentity;
  if (!hasSelectionContext) {
    return inactiveSelectedSessionViewLifecycle;
  }

  if (sessionLoadError) {
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

  if (hasSelectedSessionIdentity || isLoadingSessionReadModel) {
    return lifecycle({
      repoReadinessState,
      transcriptState: { kind: "session_loading", reason: "preparing" },
    });
  }

  return inactiveSelectedSessionViewLifecycle;
};

export const deriveAgentSessionTranscriptLifecycle = ({
  transcript,
  repoReadinessState,
}: {
  transcript: AgentSessionTranscriptSnapshot | null;
  repoReadinessState: SessionRepoReadinessState;
}): AgentSessionViewLifecycle => {
  if (!transcript) {
    return lifecycle({
      repoReadinessState,
      transcriptState: { kind: "empty" },
    });
  }

  return deriveLoadedSessionLifecycle({
    historyLoadState: transcript.historyLoadState,
    hasTranscript: transcript.hasTranscript,
    repoReadinessState,
  });
};

const toSessionTranscriptSnapshot = (
  session: Pick<AgentSessionState, "externalSessionId" | "historyLoadState" | "messages"> | null,
): AgentSessionTranscriptSnapshot | null =>
  session
    ? {
        historyLoadState: session.historyLoadState,
        hasTranscript: getSessionMessageCount(session) > 0,
      }
    : null;

export const deriveSelectedAgentSessionViewLifecycle = ({
  selectedSessionIdentity,
  session,
  hasSelectedTask,
  repoReadinessState,
  sessionLoadError,
  isLoadingSessionReadModel = false,
}: {
  selectedSessionIdentity: AgentSessionIdentity | null;
  session: AgentSessionState | null;
  hasSelectedTask: boolean;
  repoReadinessState: SessionRepoReadinessState;
  sessionLoadError?: string | null;
  isLoadingSessionReadModel?: boolean;
}): AgentSessionViewLifecycle => {
  return session
    ? deriveAgentSessionTranscriptLifecycle({
        transcript: toSessionTranscriptSnapshot(session),
        repoReadinessState,
      })
    : deriveMissingSelectedSessionLifecycle({
        hasSelectedTask,
        hasSelectedSessionIdentity: selectedSessionIdentity !== null,
        repoReadinessState,
        sessionLoadError,
        isLoadingSessionReadModel,
      });
};
