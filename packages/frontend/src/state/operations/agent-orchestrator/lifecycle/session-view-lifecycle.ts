import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionReadModelLoadState } from "@/types/agent-session-read-model";
import { getSessionMessageCount } from "../support/messages";

export type AgentSessionTranscriptState =
  | { kind: "empty" }
  | { kind: "runtime_waiting" }
  | { kind: "session_loading"; reason: "preparing" | "history" }
  | { kind: "visible" }
  | { kind: "failed" };

export const isAgentSessionTranscriptLoading = (
  transcriptState: AgentSessionTranscriptState,
): boolean =>
  transcriptState.kind === "runtime_waiting" || transcriptState.kind === "session_loading";

export const isAgentSessionTranscriptVisible = (
  transcriptState: AgentSessionTranscriptState,
): boolean => transcriptState.kind === "visible";

const inactiveSelectedSessionTranscriptState: AgentSessionTranscriptState = { kind: "empty" };

export const deriveRuntimeTranscriptState = ({
  hasVisibleTranscript,
  hasHistoryTarget,
  hasHistoryFailed,
  repoReadinessState,
}: {
  hasVisibleTranscript: boolean;
  hasHistoryTarget: boolean;
  hasHistoryFailed: boolean;
  repoReadinessState: RepoRuntimeReadinessState;
}): AgentSessionTranscriptState => {
  if (hasVisibleTranscript) {
    return { kind: "visible" };
  }

  if (!hasHistoryTarget) {
    return { kind: "empty" };
  }

  if (repoReadinessState !== "ready") {
    return { kind: "runtime_waiting" };
  }

  if (hasHistoryFailed) {
    return { kind: "failed" };
  }

  return { kind: "session_loading", reason: "history" };
};

const deriveMissingSelectedSessionTranscriptState = ({
  hasSelectedTask,
  hasSelectedSessionIdentity,
  repoReadinessState,
  sessionReadModelLoadState,
}: {
  hasSelectedTask: boolean;
  hasSelectedSessionIdentity: boolean;
  repoReadinessState: RepoRuntimeReadinessState;
  sessionReadModelLoadState: AgentSessionReadModelLoadState;
}): AgentSessionTranscriptState => {
  const hasSelectionContext = hasSelectedTask || hasSelectedSessionIdentity;
  if (!hasSelectionContext) {
    return inactiveSelectedSessionTranscriptState;
  }

  if (sessionReadModelLoadState.kind === "failed") {
    return { kind: "failed" };
  }

  if (repoReadinessState !== "ready") {
    return { kind: "runtime_waiting" };
  }

  if (hasSelectedSessionIdentity || sessionReadModelLoadState.kind === "loading") {
    return { kind: "session_loading", reason: "preparing" };
  }

  return inactiveSelectedSessionTranscriptState;
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
    ? deriveRuntimeTranscriptState({
        hasVisibleTranscript:
          getSessionMessageCount(session) > 0 || session.historyLoadState === "loaded",
        hasHistoryTarget: true,
        hasHistoryFailed: session.historyLoadState === "failed",
        repoReadinessState,
      })
    : deriveMissingSelectedSessionTranscriptState({
        hasSelectedTask,
        hasSelectedSessionIdentity: selectedSessionIdentity !== null,
        repoReadinessState,
        sessionReadModelLoadState,
      });
};
