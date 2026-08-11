import type { SessionHistoryFailure } from "@openducktor/contracts";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import { hasRenderableSessionTranscript } from "./session-transcript-content";

export type AgentSessionTranscriptEmptyReason = "inactive" | "sessionless" | "unavailable";
export type AgentSessionTranscriptLoadingReason = "preparing" | "history";

type AgentSessionTranscriptNonEmptyState =
  | { kind: "runtime_waiting" }
  | { kind: "session_loading"; reason: AgentSessionTranscriptLoadingReason }
  | { kind: "visible"; historyFailure?: SessionHistoryFailure }
  | { kind: "failed"; message: string; historyFailure?: SessionHistoryFailure };

export type AgentSessionTranscriptState =
  | { kind: "empty"; reason: AgentSessionTranscriptEmptyReason }
  | AgentSessionTranscriptNonEmptyState;

const DEFAULT_TRANSCRIPT_FAILURE = "The selected conversation could not be loaded.";

export const isAgentSessionTranscriptLoading = (
  transcriptState: AgentSessionTranscriptState,
): boolean =>
  transcriptState.kind === "runtime_waiting" || transcriptState.kind === "session_loading";

export const isAgentSessionTranscriptVisible = (
  transcriptState: AgentSessionTranscriptState,
): boolean => transcriptState.kind === "visible";

export const deriveRuntimeBoundTranscriptEmptyState = ({
  reason,
  repoReadinessState,
}: {
  reason: AgentSessionTranscriptEmptyReason;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState =>
  repoReadinessState === "ready" ? { kind: "empty", reason } : { kind: "runtime_waiting" };

export const deriveRuntimeBoundTranscriptLoadingState = ({
  reason,
  repoReadinessState,
}: {
  reason: AgentSessionTranscriptLoadingReason;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState =>
  repoReadinessState === "ready"
    ? { kind: "session_loading", reason }
    : { kind: "runtime_waiting" };

export const deriveLoadedAgentSessionTranscriptState = ({
  session,
  repoReadinessState,
}: {
  session: AgentSessionState;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  if (session.historyLoadState === "failed") {
    const historyFailure = session.historyLoadFailure;
    const message = historyFailure?.summary ?? DEFAULT_TRANSCRIPT_FAILURE;
    if (hasRenderableSessionTranscript(session)) {
      return historyFailure ? { kind: "visible", historyFailure } : { kind: "visible" };
    }

    return historyFailure
      ? { kind: "failed", message, historyFailure }
      : { kind: "failed", message };
  }

  if (session.historyLoadState === "loaded") {
    const historyFailure = session.historyLoadFailure;
    return historyFailure ? { kind: "visible", historyFailure } : { kind: "visible" };
  }

  return deriveRuntimeBoundTranscriptLoadingState({
    reason: "history",
    repoReadinessState,
  });
};

const deriveReadModelFailureTranscriptState = (
  readModelLoadState: AgentSessionReadModelLoadState,
): AgentSessionTranscriptState | null =>
  readModelLoadState.kind === "failed"
    ? { kind: "failed", message: readModelLoadState.message }
    : null;

export const derivePendingSelectedSessionTranscriptState = ({
  readModelLoadState,
  repoReadinessState,
}: {
  readModelLoadState: AgentSessionReadModelLoadState;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState =>
  deriveReadModelFailureTranscriptState(readModelLoadState) ??
  deriveRuntimeBoundTranscriptLoadingState({
    reason: "preparing",
    repoReadinessState,
  });

export const deriveSessionlessTaskTranscriptState = ({
  readModelLoadState,
  repoReadinessState,
}: {
  readModelLoadState: AgentSessionReadModelLoadState;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState =>
  deriveReadModelFailureTranscriptState(readModelLoadState) ??
  (readModelLoadState.kind === "loading"
    ? deriveRuntimeBoundTranscriptLoadingState({
        reason: "preparing",
        repoReadinessState,
      })
    : deriveRuntimeBoundTranscriptEmptyState({
        reason: "sessionless",
        repoReadinessState,
      }));
