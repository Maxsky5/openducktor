import type { AgentEnginePort, AgentModelSelection } from "@openducktor/core";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import { type ReadSessionSnapshot, requireLoadedSession } from "../support/session-invariants";
import {
  requireBoundSessionAssociation,
  toRuntimeSessionRef,
} from "../support/session-runtime-ref";
import type { CommitSessionModelChange } from "./workflow-session-operation-policy";

export type SessionModelActionDependencies = {
  adapter: Pick<AgentEnginePort, "updateSessionModel">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
  commitSessionModelChange: CommitSessionModelChange;
};

export const createSessionModelActions = ({
  adapter,
  readSessionSnapshot,
  updateSession,
  commitSessionModelChange,
}: SessionModelActionDependencies) => {
  const updateAgentSessionModel = async (
    identity: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ): Promise<void> => {
    const session = requireLoadedSession(readSessionSnapshot, identity);
    requireBoundSessionAssociation(session, "change model");

    await adapter.updateSessionModel({
      ...toRuntimeSessionRef(session.repoPath, session),
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
    await commitSessionModelChange(nextSession);
  };

  return { updateAgentSessionModel };
};
