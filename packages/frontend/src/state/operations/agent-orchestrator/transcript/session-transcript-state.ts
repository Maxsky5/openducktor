import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
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

export type SelectedAgentSessionTranscriptSource =
  | { kind: "inactive" }
  | { kind: "loaded_session"; session: AgentSessionState }
  | { kind: "selected_session"; readModelLoadState: AgentSessionReadModelLoadState }
  | { kind: "selected_task"; readModelLoadState: AgentSessionReadModelLoadState };

const DEFAULT_TRANSCRIPT_FAILURE_MESSAGE = "The selected conversation could not be loaded.";

export const isAgentSessionTranscriptLoading = (
  transcriptState: AgentSessionTranscriptState,
): boolean =>
  transcriptState.kind === "runtime_waiting" || transcriptState.kind === "session_loading";

export const isAgentSessionTranscriptVisible = (
  transcriptState: AgentSessionTranscriptState,
): boolean => transcriptState.kind === "visible";

const inactiveAgentSessionTranscriptState: AgentSessionTranscriptState = {
  kind: "empty",
  reason: "inactive",
};

const sessionlessAgentSessionTranscriptState: AgentSessionTranscriptState = {
  kind: "empty",
  reason: "sessionless",
};

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

const deriveMissingSelectedSessionTranscriptState = ({
  source,
  repoReadinessState,
}: {
  source: Exclude<SelectedAgentSessionTranscriptSource, { kind: "loaded_session" }>;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  if (source.kind === "inactive") {
    return inactiveAgentSessionTranscriptState;
  }

  if (source.readModelLoadState.kind === "failed") {
    return { kind: "failed", message: source.readModelLoadState.message };
  }

  if (repoReadinessState !== "ready") {
    return { kind: "runtime_waiting" };
  }

  if (source.kind === "selected_session" || source.readModelLoadState.kind === "loading") {
    return { kind: "session_loading", reason: "preparing" };
  }

  return sessionlessAgentSessionTranscriptState;
};

const deriveLoadedSelectedSessionTranscriptState = ({
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

export const deriveSelectedAgentSessionTranscriptState = ({
  source,
  repoReadinessState,
}: {
  source: SelectedAgentSessionTranscriptSource;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  return source.kind === "loaded_session"
    ? deriveLoadedSelectedSessionTranscriptState({
        session: source.session,
        repoReadinessState,
      })
    : deriveMissingSelectedSessionTranscriptState({
        source,
        repoReadinessState,
      });
};
