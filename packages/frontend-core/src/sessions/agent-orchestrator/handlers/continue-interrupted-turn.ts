import type { AgentEnginePort } from "@openducktor/core";
import type { AgentSessionIdentity } from "../../../types/agent-orchestrator";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import { toBoundRuntimeSessionRef } from "../support/session-runtime-ref";

export type ContinueInterruptedTurnDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "continueInterruptedTurn">;
  readSessionSnapshot: ReadSessionSnapshot;
  /** Waits for the model changes of the session, so the turn continues with the shown model. */
  settleModelUpdates: (session: AgentSessionIdentity) => Promise<void>;
};

/**
 * Starts one native continuation of the latest unfinished turn. The runtime emits the
 * new output through the live session stream, so this call writes no local session state
 * and leaves the composer draft and transcript untouched. A host failure propagates
 * unchanged so the chat can show its typed reason and next action.
 */
export const createContinueInterruptedTurn = ({
  workspaceRepoPath,
  adapter,
  readSessionSnapshot,
  settleModelUpdates,
}: ContinueInterruptedTurnDependencies) => {
  return async (identity: AgentSessionIdentity): Promise<void> => {
    await settleModelUpdates(identity);
    const session = readSessionSnapshot(identity);
    if (!session) {
      throw new Error(
        `Session '${identity.externalSessionId}' is no longer loaded. Reload the session, then retry Resume.`,
      );
    }
    const sessionRef = toBoundRuntimeSessionRef(
      requireWorkspaceRepoPath(workspaceRepoPath),
      session,
      "resume",
    );
    const continuationInput: Parameters<typeof adapter.continueInterruptedTurn>[0] = {
      ...sessionRef,
    };
    // Keep the host failure intact: the chat reads its typed reason and next action.
    await adapter.continueInterruptedTurn(continuationInput);
  };
};
