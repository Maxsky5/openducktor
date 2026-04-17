import type { AgentSessionState, RepoScopedAgentSessionState } from "@/types/agent-orchestrator";

export const createRepoScopedAgentSessionState = (
  session: Omit<AgentSessionState, "repoPath">,
  repoPath: string,
): RepoScopedAgentSessionState => ({
  ...session,
  repoPath,
});

export const requireRepoScopedAgentSessionState = (
  session: AgentSessionState,
): RepoScopedAgentSessionState => {
  if (!session.repoPath) {
    throw new Error(`Agent session '${session.sessionId}' is missing repoPath metadata.`);
  }

  return session as RepoScopedAgentSessionState;
};
