import type {
  AgentEnginePort,
  AgentModelSelection,
  UpdateControlledAgentSessionModelInput,
} from "@openducktor/core";
import { agentSessionIdentityKey } from "../../../lib/agent-session-identity";
import { errorMessage } from "../../../lib/errors";
import { createOptimisticWrites, type OptimisticWrites } from "../../../lib/optimistic-writes";
import type { AgentSessionIdentity, AgentSessionState } from "../../../types/agent-orchestrator";
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
  const model: NonNullable<UpdateControlledAgentSessionModelInput["model"]> = {
    providerId: selection.providerId,
    modelId: selection.modelId,
    variant: selection.variant,
  };
  if (selection.speed !== undefined) model.speed = selection.speed;
  if (session.runtimeKind === "opencode" && selection.profileId !== undefined)
    model.profileId = selection.profileId;
  return model;
};

/**
 * Model changes show at once. Each session writes its changes to the runtime in order, in the
 * background. A failed write shows the last confirmed selection again, unless a later change waits.
 */
export const createSessionModelActions = ({
  workspaceRepoPath,
  adapter,
  readSessionSnapshot,
  updateSession,
}: SessionModelActionDependencies) => {
  const writesBySession = new Map<string, OptimisticWrites<AgentModelSelection | null>>();

  const writesOf = (identity: AgentSessionIdentity) => {
    const key = agentSessionIdentityKey(identity);
    const existing = writesBySession.get(key);
    if (existing) return existing;
    const writes = createOptimisticWrites<AgentModelSelection | null>({
      show: (selection) => {
        const session = readSessionSnapshot(identity);
        if (session)
          updateSession(session, (current) => ({
            ...current,
            selectedModel: selection,
            modelUpdatePending: true,
          }));
      },
      readConfirmed: () => readSessionSnapshot(identity)?.selectedModel ?? null,
      onIdle: () => {
        writesBySession.delete(key);
        const session = readSessionSnapshot(identity);
        if (session)
          updateSession(session, (current) => ({ ...current, modelUpdatePending: undefined }));
      },
    });
    writesBySession.set(key, writes);
    return writes;
  };

  const updateAgentSessionModel = async (
    identity: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ): Promise<void> => {
    const session = requireLoadedSession(readSessionSnapshot, identity);
    const sessionScope = requireBoundSessionAssociation(session, "change model");
    const model = toSessionModelSettings(session, selection);
    const input = {
      ...toRuntimeSessionRef(requireWorkspaceRepoPath(workspaceRepoPath), session),
      sessionScope,
      model,
    };
    await writesOf(identity).write(selection, async () => {
      await adapter.updateSessionModel(input);
      return selection;
    });
  };

  /**
   * Waits for the model writes of a session, so a message runs with the model that the composer
   * shows. Fails when the newest write failed.
   */
  const settleModelUpdates = async (identity: AgentSessionIdentity): Promise<void> => {
    const newest = writesBySession.get(agentSessionIdentityKey(identity))?.settled();
    if (!newest) return;
    await newest.catch((cause: unknown) => {
      throw new Error(
        `The model change failed, so the message was not sent. Check the model, then send again. ${errorMessage(cause)}`,
      );
    });
  };

  return { updateAgentSessionModel, settleModelUpdates };
};
