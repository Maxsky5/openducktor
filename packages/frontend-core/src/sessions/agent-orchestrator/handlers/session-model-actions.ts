import type {
  AgentEnginePort,
  AgentModelSelection,
  UpdateControlledAgentSessionModelInput,
} from "@openducktor/core";
import { agentSessionIdentityKey } from "../../../lib/agent-session-identity";
import { errorMessage } from "../../../lib/errors";
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

/** The model writes of one session: they run in order, and the last confirmed selection. */
type SessionModelWrites = {
  confirmed: AgentModelSelection | null;
  /** The newest write. A send waits for it. */
  latest: Promise<void>;
  pending: number;
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
  const writesBySession = new Map<string, SessionModelWrites>();

  const showSelection = (
    identity: AgentSessionIdentity,
    selection: AgentModelSelection | null,
  ): void => {
    const session = readSessionSnapshot(identity);
    if (session) updateSession(session, (current) => ({ ...current, selectedModel: selection }));
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
    const key = agentSessionIdentityKey(identity);
    const writes = writesBySession.get(key) ?? {
      confirmed: session.selectedModel ?? null,
      latest: Promise.resolve(),
      pending: 0,
    };
    writesBySession.set(key, writes);

    showSelection(identity, selection);
    const write = writes.latest.then(
      () => adapter.updateSessionModel(input),
      () => adapter.updateSessionModel(input),
    );
    writes.latest = write;
    writes.pending += 1;
    try {
      await write;
      writes.confirmed = selection;
    } catch (cause) {
      if (writes.pending === 1) showSelection(identity, writes.confirmed);
      throw cause;
    } finally {
      writes.pending -= 1;
      if (writes.pending === 0) writesBySession.delete(key);
    }
  };

  /**
   * Waits for the model writes of a session, so a message runs with the model that the composer
   * shows. Fails when the newest write failed.
   */
  const settleModelUpdates = async (identity: AgentSessionIdentity): Promise<void> => {
    const writes = writesBySession.get(agentSessionIdentityKey(identity));
    if (!writes) return;
    await writes.latest.catch((cause: unknown) => {
      throw new Error(
        `The model change failed, so the message was not sent. Check the model, then send again. ${errorMessage(cause)}`,
      );
    });
  };

  return { updateAgentSessionModel, settleModelUpdates };
};
