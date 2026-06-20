import type { AgentEnginePort, AgentModelSelection } from "@openducktor/core";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import {
  type ReadSessionSnapshot,
  requireLoadedSession,
  requireWorkspaceRepoPath,
} from "../support/session-invariants";
import { toRuntimeSessionRef } from "../support/session-runtime-ref";

export type SessionModelActionDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "updateSessionModel">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  isSessionObserved: (identity: AgentSessionIdentity) => boolean;
};

export const createSessionModelActions = ({
  workspaceRepoPath,
  adapter,
  readSessionSnapshot,
  updateSession,
  isSessionObserved,
}: SessionModelActionDependencies) => {
  const updateAgentSessionModel = (
    identity: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ): void => {
    const session = requireLoadedSession(readSessionSnapshot, identity);
    const repoPath = requireWorkspaceRepoPath(workspaceRepoPath);

    const updatedSession = updateSession(
      session,
      (current) => ({
        ...current,
        selectedModel: selection,
      }),
      { persist: true },
    );

    if (!updatedSession || !isSessionObserved(updatedSession)) {
      return;
    }

    adapter.updateSessionModel({
      ...toRuntimeSessionRef(repoPath, updatedSession),
      model: selection,
    });
  };

  return { updateAgentSessionModel };
};
