import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { hasRenderableSessionTranscript } from "../support/session-transcript-content";

export type AgentSessionTranscriptEmptyReason = "inactive" | "sessionless" | "unavailable";
export type AgentSessionTranscriptLoadingReason = "preparing" | "history";

type AgentSessionTranscriptNonEmptyState =
  | { kind: "runtime_waiting" }
  | { kind: "session_loading"; reason: AgentSessionTranscriptLoadingReason }
  | { kind: "visible" }
  | { kind: "failed"; message: string };

export type AgentSessionTranscriptState =
  | { kind: "empty"; reason: AgentSessionTranscriptEmptyReason }
  | AgentSessionTranscriptNonEmptyState;

const DEFAULT_TRANSCRIPT_FAILURE_MESSAGE = "The selected conversation could not be loaded.";

export const visibleAgentSessionTranscriptState = (): AgentSessionTranscriptState => ({
  kind: "visible",
});

export const emptyAgentSessionTranscriptState = (
  reason: AgentSessionTranscriptEmptyReason,
): AgentSessionTranscriptState => ({
  kind: "empty",
  reason,
});

export const failedAgentSessionTranscriptState = (
  message: string,
): AgentSessionTranscriptState => ({
  kind: "failed",
  message,
});

export const isAgentSessionTranscriptLoading = (
  transcriptState: AgentSessionTranscriptState,
): boolean =>
  transcriptState.kind === "runtime_waiting" || transcriptState.kind === "session_loading";

export const isAgentSessionTranscriptVisible = (
  transcriptState: AgentSessionTranscriptState,
): boolean => transcriptState.kind === "visible";

export const loadingAgentSessionTranscriptState = ({
  reason,
  repoReadinessState,
}: {
  reason: AgentSessionTranscriptLoadingReason;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  if (repoReadinessState !== "ready") {
    return { kind: "runtime_waiting" };
  }

  return { kind: "session_loading", reason };
};

export const emptyAfterRuntimeReadyAgentSessionTranscriptState = ({
  reason,
  repoReadinessState,
}: {
  reason: AgentSessionTranscriptEmptyReason;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  if (repoReadinessState !== "ready") {
    return { kind: "runtime_waiting" };
  }

  return emptyAgentSessionTranscriptState(reason);
};

export const deriveLoadedAgentSessionTranscriptState = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  if (hasRenderableSessionTranscript(session)) {
    return visibleAgentSessionTranscriptState();
  }

  if (session.historyLoadState === "failed" && repoReadinessState === "ready") {
    return failedAgentSessionTranscriptState(DEFAULT_TRANSCRIPT_FAILURE_MESSAGE);
  }

  return loadingAgentSessionTranscriptState({
    reason: "history",
    repoReadinessState,
  });
};
