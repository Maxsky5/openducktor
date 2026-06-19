import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { hasRenderableSessionTranscript } from "../support/session-transcript-content";

export type AgentSessionTranscriptEmptyReason = "inactive" | "sessionless" | "unavailable";
export type AgentSessionTranscriptLoadingReason = "preparing" | "history";

export type AgentSessionTranscriptSource =
  | { kind: "visible" }
  | { kind: "empty"; reason: AgentSessionTranscriptEmptyReason }
  | { kind: "runtime_gated_empty"; reason: AgentSessionTranscriptEmptyReason }
  | { kind: "runtime_gated_loading"; reason: AgentSessionTranscriptLoadingReason }
  | { kind: "failed"; message: string };

type AgentSessionTranscriptNonEmptyState =
  | { kind: "runtime_waiting" }
  | { kind: "session_loading"; reason: AgentSessionTranscriptLoadingReason }
  | { kind: "visible" }
  | { kind: "failed"; message: string };

export type AgentSessionTranscriptState =
  | { kind: "empty"; reason: AgentSessionTranscriptEmptyReason }
  | AgentSessionTranscriptNonEmptyState;

const DEFAULT_TRANSCRIPT_FAILURE_MESSAGE = "The selected conversation could not be loaded.";

export const isAgentSessionTranscriptLoading = (
  transcriptState: AgentSessionTranscriptState,
): boolean =>
  transcriptState.kind === "runtime_waiting" || transcriptState.kind === "session_loading";

export const isAgentSessionTranscriptVisible = (
  transcriptState: AgentSessionTranscriptState,
): boolean => transcriptState.kind === "visible";

export const deriveLoadedAgentSessionTranscriptSource = (
  session: AgentSessionState,
): AgentSessionTranscriptSource => {
  if (hasRenderableSessionTranscript(session)) {
    return { kind: "visible" };
  }

  if (session.historyLoadState === "failed") {
    return { kind: "failed", message: DEFAULT_TRANSCRIPT_FAILURE_MESSAGE };
  }

  return {
    kind: "runtime_gated_loading",
    reason: "history",
  };
};

export const deriveAgentSessionTranscriptState = ({
  source,
  repoReadinessState,
}: {
  source: AgentSessionTranscriptSource;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  switch (source.kind) {
    case "visible":
      return { kind: "visible" };
    case "empty":
      return { kind: "empty", reason: source.reason };
    case "runtime_gated_empty":
      return repoReadinessState === "ready"
        ? { kind: "empty", reason: source.reason }
        : { kind: "runtime_waiting" };
    case "runtime_gated_loading":
      return repoReadinessState === "ready"
        ? { kind: "session_loading", reason: source.reason }
        : { kind: "runtime_waiting" };
    case "failed":
      return { kind: "failed", message: source.message };
  }
};
