export type AgentSessionReadModelFailureSource = "task-records" | "live-stream";

export type AgentSessionReadModelLoadState =
  | { kind: "unavailable" }
  | { kind: "loading"; workspaceRepoPath: string }
  | { kind: "ready"; workspaceRepoPath: string }
  | {
      kind: "failed";
      workspaceRepoPath: string;
      message: string;
      /** Which producer owns this failure; a successful record load clears only its own source. */
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
  source: AgentSessionReadModelFailureSource = "live-stream",
): AgentSessionReadModelLoadState => ({
  kind: "failed",
  workspaceRepoPath,
  message,
  source,
});

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
