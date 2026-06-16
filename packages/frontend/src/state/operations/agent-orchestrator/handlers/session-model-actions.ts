import type { AgentEnginePort, AgentModelSelection } from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { toRuntimeSessionRef } from "../support/session-runtime-ref";
import { requireWorkspaceRepoPath } from "./session-action-guards";

type ReadSessionSnapshot = (identity: AgentSessionIdentity) => AgentSessionState | null;
type UpdateSession = (
  identity: AgentSessionIdentity,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => AgentSessionState | null;

export type SessionModelActionDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "updateSessionModel">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
};

export const createSessionModelActions = ({
  workspaceRepoPath,
  adapter,
  readSessionSnapshot,
  updateSession,
}: SessionModelActionDependencies) => {
  const updateAgentSessionModel = (
    identity: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ): void => {
    const session = readSessionSnapshot(identity);
    if (!session) {
      return;
    }
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);

    adapter.updateSessionModel({
      ...toRuntimeSessionRef(repoPath, session),
      externalSessionId: session.externalSessionId,
      model: selection,
    });

    updateSession(
      session,
      (current) => ({
        ...current,
        selectedModel: selection,
      }),
      { persist: true },
    );
  };

  return { updateAgentSessionModel };
};
