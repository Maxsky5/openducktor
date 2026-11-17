import type { AgentEnginePort } from "@openducktor/core";
import type { AgentSessionIdentity } from "../../../types/agent-orchestrator";
import { type ReadSessionSnapshot, requireWorkspaceRepoPath } from "../support/session-invariants";
import { toBoundRuntimeSessionRef } from "../support/session-runtime-ref";

export type CancelUsageLimitAutoResumeDependencies = {
  workspaceRepoPath: string | null;
  adapter: Pick<AgentEnginePort, "cancelUsageLimitAutoResume">;
  readSessionSnapshot: ReadSessionSnapshot;
};

/**
 * Cancels the host-planned resume of one usage-limit stop. The host publishes the removal to
 * every client, so this call writes no local session state.
 */
export const createCancelUsageLimitAutoResume = ({
  workspaceRepoPath,
  adapter,
  readSessionSnapshot,
}: CancelUsageLimitAutoResumeDependencies) => {
  return async (identity: AgentSessionIdentity, stopId: string): Promise<void> => {
    const session = readSessionSnapshot(identity);
    if (!session) {
      throw new Error(
        `Session '${identity.externalSessionId}' is no longer loaded. Reload the session, then cancel again.`,
      );
    }
    const { repoPath, runtimeKind, workingDirectory, externalSessionId, sessionScope } =
      toBoundRuntimeSessionRef(
        requireWorkspaceRepoPath(workspaceRepoPath),
        session,
        "cancel auto-resume",
      );
    await adapter.cancelUsageLimitAutoResume({
      repoPath,
      runtimeKind,
      workingDirectory,
      externalSessionId,
      sessionScope,
      stopId,
    });
  };
};
