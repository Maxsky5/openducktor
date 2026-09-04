import type {
  AgentEnginePort,
  AgentModelSelection,
  UpdateControlledAgentSessionModelInput,
} from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
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

const toSessionModelSettings = (
  session: AgentSessionState,
  selection: AgentModelSelection | null,
): UpdateControlledAgentSessionModelInput["model"] => {
  if (!selection) {
    return null;
  }
  if (selection.runtimeKind && selection.runtimeKind !== session.runtimeKind) {
    throw new Error(
      `Session '${session.externalSessionId}' cannot move from '${session.runtimeKind}' to '${selection.runtimeKind}'.`,
    );
  }
  return {
    providerId: selection.providerId,
    modelId: selection.modelId,
    variant: selection.variant,
  };
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
    const model = toSessionModelSettings(session, selection);

    await adapter.updateSessionModel({
      ...toRuntimeSessionRef(requireWorkspaceRepoPath(workspaceRepoPath), session),
      sessionScope,
      model,
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
