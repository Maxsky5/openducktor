import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
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
  hasVisibleTranscript,
  hasHistoryTarget,
  historyFailureMessage,
  repoReadinessState,
  emptyReason,
}: {
  hasVisibleTranscript: boolean;
  hasHistoryTarget: boolean;
  historyFailureMessage: string | null;
  repoReadinessState: RepoRuntimeReadinessState;
  emptyReason?: AgentSessionTranscriptEmptyReason;
}): AgentSessionTranscriptState => {
  if (hasVisibleTranscript) {
    return { kind: "visible" };
  }

  if (!hasHistoryTarget) {
    return {
      kind: "empty",
      reason: emptyReason ?? "inactive",
    };
  }

  if (repoReadinessState !== "ready") {
    return { kind: "runtime_waiting" };
  }

  if (historyFailureMessage !== null) {
    return { kind: "failed", message: historyFailureMessage };
  }

  return { kind: "session_loading", reason: "history" };
};

const deriveMissingSelectedSessionTranscriptState = ({
  hasSelectedTask,
  selectedSessionIdentity,
  repoReadinessState,
  sessionReadModelLoadState,
}: {
  hasSelectedTask: boolean;
  selectedSessionIdentity: AgentSessionIdentity | null;
  repoReadinessState: RepoRuntimeReadinessState;
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
}): AgentSessionTranscriptState => {
  const hasSelectedSession = selectedSessionIdentity !== null;
  const hasSelectionContext = hasSelectedTask || hasSelectedSession;
  if (!hasSelectionContext) {
    return inactiveAgentSessionTranscriptState;
  }

  if (sessionReadModelLoadState.kind === "failed") {
    return { kind: "failed", message: sessionReadModelLoadState.message };
  }

  if (repoReadinessState !== "ready") {
    return { kind: "runtime_waiting" };
  }

  if (hasSelectedSession || sessionReadModelLoadState.kind === "loading") {
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
  if (hasRenderableSessionTranscript(session)) {
    return { kind: "visible" };
  }

  if (repoReadinessState !== "ready") {
    return { kind: "runtime_waiting" };
  }

  if (session.historyLoadState === "failed") {
    return { kind: "failed", message: DEFAULT_TRANSCRIPT_FAILURE_MESSAGE };
  }

  return { kind: "session_loading", reason: "history" };
};

export const deriveSelectedAgentSessionTranscriptState = ({
  selectedSessionIdentity,
  session,
  hasSelectedTask,
  repoReadinessState,
  sessionReadModelLoadState,
}: {
  selectedSessionIdentity: AgentSessionIdentity | null;
  session: AgentSessionState | null;
  hasSelectedTask: boolean;
  repoReadinessState: RepoRuntimeReadinessState;
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
}): AgentSessionTranscriptState => {
  return session
    ? deriveLoadedSelectedSessionTranscriptState({
        session,
        repoReadinessState,
      })
    : deriveMissingSelectedSessionTranscriptState({
        hasSelectedTask,
        selectedSessionIdentity,
        repoReadinessState,
        sessionReadModelLoadState,
      });
};
