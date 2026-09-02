import type { AgentEnginePort, AgentModelSelection } from "@openducktor/core";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import {
  type ReadSessionSnapshot,
  requireLoadedSession,
  requireWorkspaceRepoPath,
} from "../support/session-invariants";
import {
  requireBoundSessionAssociation,
  toRuntimeSessionRef,
} from "../support/session-runtime-ref";

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
  const updateAgentSessionModel = async (
    identity: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ): Promise<void> => {
    const session = requireLoadedSession(readSessionSnapshot, identity);
    const sessionScope = requireBoundSessionAssociation(session, "change model");

    await adapter.updateSessionModel({
      ...toRuntimeSessionRef(requireWorkspaceRepoPath(workspaceRepoPath), session),
      sessionScope,
      model: selection,
    });

    const nextSession =
      updateSession(session, (current) => ({
        ...current,
        selectedModel: selection,
      })) ?? readSessionSnapshot(session);
    if (!nextSession) {
      throw new Error(
        `Session '${session.externalSessionId}' became unavailable after its model changed.`,
      );
    }
  };

  return { updateAgentSessionModel };
};
