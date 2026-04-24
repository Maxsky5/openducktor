import type { AgentSessionState } from "@/types/agent-orchestrator";

export const createRepoScopedAgentSessionState = (
  session: Omit<AgentSessionState, "repoPath">,
  repoPath: string,
): AgentSessionState => ({
  ...session,
  repoPath,
});
