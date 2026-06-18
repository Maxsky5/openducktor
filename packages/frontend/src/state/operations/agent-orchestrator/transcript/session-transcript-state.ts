import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { hasRenderableSessionTranscript } from "../support/session-transcript-content";

export type AgentSessionTranscriptEmptyReason = "inactive" | "sessionless" | "unavailable";

type AgentSessionTranscriptNonEmptyState =
  | { kind: "runtime_waiting" }
  | { kind: "session_loading"; reason: "preparing" | "history" }
  | { kind: "visible" }
  | { kind: "failed"; message: string };

export type AgentSessionTranscriptState =
  | { kind: "empty"; reason: AgentSessionTranscriptEmptyReason }
  | AgentSessionTranscriptNonEmptyState;

export type RuntimeTranscriptStateSource =
  | { kind: "empty"; reason: AgentSessionTranscriptEmptyReason }
  | { kind: "history"; failureMessage: string | null }
  | { kind: "visible" };

const DEFAULT_TRANSCRIPT_FAILURE_MESSAGE = "The selected conversation could not be loaded.";

export const isAgentSessionTranscriptLoading = (
  transcriptState: AgentSessionTranscriptState,
): boolean =>
  transcriptState.kind === "runtime_waiting" || transcriptState.kind === "session_loading";

export const isAgentSessionTranscriptVisible = (
  transcriptState: AgentSessionTranscriptState,
): boolean => transcriptState.kind === "visible";

export const deriveRuntimeTranscriptState = ({
  source,
  repoReadinessState,
}: {
  source: RuntimeTranscriptStateSource;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  if (source.kind === "visible") {
    return { kind: "visible" };
  }

  if (source.kind === "empty") {
    return {
      kind: "empty",
      reason: source.reason,
    };
  }

  if (repoReadinessState !== "ready") {
    return { kind: "runtime_waiting" };
  }

  if (source.failureMessage !== null) {
    return { kind: "failed", message: source.failureMessage };
  }

  return { kind: "session_loading", reason: "history" };
};

export const deriveLoadedAgentSessionTranscriptState = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  const source: RuntimeTranscriptStateSource = hasRenderableSessionTranscript(session)
    ? { kind: "visible" }
    : {
        kind: "history",
        failureMessage:
          session.historyLoadState === "failed" ? DEFAULT_TRANSCRIPT_FAILURE_MESSAGE : null,
      };

  return deriveRuntimeTranscriptState({
    source,
    repoReadinessState,
  });
};
