import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
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

export type AgentSessionTranscriptSource =
  | { kind: "empty"; reason: AgentSessionTranscriptEmptyReason }
  | { kind: "runtime_gated_empty"; reason: AgentSessionTranscriptEmptyReason }
  | { kind: "pending"; reason: AgentSessionTranscriptLoadingReason }
  | { kind: "failed"; message: string }
  | { kind: "visible" };

const DEFAULT_TRANSCRIPT_FAILURE_MESSAGE = "The selected conversation could not be loaded.";

const deriveLoadedAgentSessionTranscriptSource = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptSource => {
  if (hasRenderableSessionTranscript(session)) {
    return { kind: "visible" };
  }

  if (session.historyLoadState === "failed" && repoReadinessState === "ready") {
    return { kind: "failed", message: DEFAULT_TRANSCRIPT_FAILURE_MESSAGE };
  }

  return { kind: "pending", reason: "history" };
};

export const isAgentSessionTranscriptLoading = (
  transcriptState: AgentSessionTranscriptState,
): boolean =>
  transcriptState.kind === "runtime_waiting" || transcriptState.kind === "session_loading";

export const isAgentSessionTranscriptVisible = (
  transcriptState: AgentSessionTranscriptState,
): boolean => transcriptState.kind === "visible";

export const deriveAgentSessionTranscriptState = ({
  source,
  repoReadinessState,
}: {
  source: AgentSessionTranscriptSource;
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

  if (source.kind === "runtime_gated_empty") {
    if (repoReadinessState !== "ready") {
      return { kind: "runtime_waiting" };
    }

    return {
      kind: "empty",
      reason: source.reason,
    };
  }

  if (source.kind === "failed") {
    return { kind: "failed", message: source.message };
  }

  if (repoReadinessState !== "ready") {
    return { kind: "runtime_waiting" };
  }

  return { kind: "session_loading", reason: source.reason };
};

export const deriveLoadedAgentSessionTranscriptState = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  const source = deriveLoadedAgentSessionTranscriptSource({
    session,
    repoReadinessState,
  });

  return deriveAgentSessionTranscriptState({
    source,
    repoReadinessState,
  });
};
