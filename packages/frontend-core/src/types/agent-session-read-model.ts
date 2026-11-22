export type AgentSessionReadModelFailureSource = "task-records" | "live-stream";

export type AgentSessionReadModelLoadState =
  | { kind: "unavailable" }
  | {
      kind: "loading";
      workspaceRepoPath: string;
      /**
       * The failure of a live stream that a new observation has not confirmed yet. The live state
       * that the failed stream reported stays unknown until the new snapshot arrives.
       */
      liveStreamFailure?: string;
    }
  | { kind: "ready"; workspaceRepoPath: string }
  | {
      kind: "failed";
      workspaceRepoPath: string;
      message: string;
      source: AgentSessionReadModelFailureSource;
    };

export const unavailableAgentSessionReadModelLoadState: AgentSessionReadModelLoadState =
  Object.freeze({
    kind: "unavailable",
  });

export const loadingAgentSessionReadModelLoadState = (
  workspaceRepoPath: string,
): AgentSessionReadModelLoadState => ({
  kind: "loading",
  workspaceRepoPath,
});

export const readyAgentSessionReadModelLoadState = (
  workspaceRepoPath: string,
): AgentSessionReadModelLoadState => ({
  kind: "ready",
  workspaceRepoPath,
});

export const failedAgentSessionReadModelLoadState = (
  workspaceRepoPath: string,
  message: string,
  source: AgentSessionReadModelFailureSource,
): AgentSessionReadModelLoadState => ({
  kind: "failed",
  workspaceRepoPath,
  message,
  source,
});

/** The live-stream failure that no fresh snapshot has confirmed as recovered yet, else null. */
export const unresolvedLiveStreamFailure = (
  state: AgentSessionReadModelLoadState,
): string | null => {
  if (state.kind === "failed" && state.source === "live-stream") return state.message;
  if (state.kind === "loading") return state.liveStreamFailure ?? null;
  return null;
};

/**
 * The load state of a failed task-record or task-list read. An unresolved live-stream failure
 * wins, so a view cannot show the last live state as current while the stream is down. The
 * task-record failure shows after a fresh snapshot resolves the live-stream failure.
 */
export const failedTaskRecordsLoadState = ({
  workspaceRepoPath,
  message,
  liveStreamFailure,
}: {
  workspaceRepoPath: string;
  message: string;
  liveStreamFailure: string | null;
}): AgentSessionReadModelLoadState =>
  liveStreamFailure === null
    ? failedAgentSessionReadModelLoadState(workspaceRepoPath, message, "task-records")
    : failedAgentSessionReadModelLoadState(workspaceRepoPath, liveStreamFailure, "live-stream");

export const currentAgentSessionReadModelLoadState = ({
  workspaceRepoPath,
  state,
}: {
  workspaceRepoPath: string | null;
  state: AgentSessionReadModelLoadState;
}): AgentSessionReadModelLoadState => {
  if (!workspaceRepoPath) {
    return unavailableAgentSessionReadModelLoadState;
  }

  if (state.kind !== "unavailable" && state.workspaceRepoPath === workspaceRepoPath) {
    return state;
  }

  return loadingAgentSessionReadModelLoadState(workspaceRepoPath);
};
