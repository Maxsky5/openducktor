import type { AgentSessionState } from "@/types/agent-orchestrator";

export const createRepoScopedAgentSessionState = <
  TSession extends Omit<AgentSessionState, "repoPath">,
>(
  session: TSession,
  repoPath: string,
): TSession & Pick<AgentSessionState, "repoPath"> => ({
  ...session,
  repoPath,
});
