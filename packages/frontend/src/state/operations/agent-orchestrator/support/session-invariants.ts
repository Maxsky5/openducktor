import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export type ReadSessionSnapshot = (identity: AgentSessionIdentity) => AgentSessionState | null;

export const requireWorkspaceRepoPath = (workspaceRepoPath: string | null): string => {
  if (!workspaceRepoPath) {
    throw new Error("Active workspace repo path is unavailable.");
  }
  return workspaceRepoPath;
};

export const requireLoadedSession = (
  readSessionSnapshot: ReadSessionSnapshot,
  identity: AgentSessionIdentity,
): AgentSessionState => {
  const session = readSessionSnapshot(identity);
  if (!session) {
    throw new Error(`Session '${identity.externalSessionId}' is not loaded.`);
  }
  return session;
};
