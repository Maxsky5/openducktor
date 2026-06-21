export type AgentSessionReadModelLoadState =
  | { kind: "unavailable" }
  | { kind: "loading"; workspaceRepoPath: string }
  | { kind: "ready"; workspaceRepoPath: string }
  | { kind: "failed"; workspaceRepoPath: string; message: string };

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
): AgentSessionReadModelLoadState => ({
  kind: "failed",
  workspaceRepoPath,
  message,
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
